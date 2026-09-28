# Continuing: handoff (2026-09-28, afternoon)

Ten things are open:
1. **The 0.4.5 build.** It started today and paused at about 13:10, when the account hit its usage limit (it resets at 2:10 pm Central). The work is partial and uncommitted, in worktrees on this PC only.
2. **Home PCs that keep working, and reaching them from Discord** (the co-work session). Start with Windows, the Your PCs agent lines and the Studio side of the Discord remote are on main. The bot side is parked as `wip/remote-dms`. The end-to-end test, the owner's setup and subscriptions-first routing are left (section 2).
3. **Menu Batch 3.** This is the owner's decision, unchanged (section 3).
4. **The website rebuild** (the "Continuing fixes" session). It is parked on the pushed branch `wip/site-rebuild` and is not published: the build agents hit the same usage limit (section 4).
5. **Model tracker, community model ratings and probes** (the "Discord bot model feedback integration" session). The Studio half is gated on `wip/model-community`; the bot half is built and tested on the bot's `wip/model-reviews`, but not documented or wired yet (section 5).
6. **Build as a coding-agent desktop.** Built but untested, on the pushed branch `wip/builder-mode`. Vibe as the social mode is not started (section 6).
7. **In-app performance: tree brightness** (the "In-app performance" session). The owner's 200% tree brightness keeps the GPU at 98–100% (Vibe 4.6 fps, Command 8.8, Home 4.1). A fix that brings them to 42, 36 and 43 fps is parked on the pushed branch `wip/tree-brightness-gpu`. It waits on the outline step and an owner look check (section 7).
8. **The media player redesign** (the "Media player UI and performance improvements" session). A mini player with a transport, quick tree switches and a YouTube feed, on the pushed branch `wip/media-player-redesign`. It works in the offscreen probe; its tests aren't updated and it isn't landed (section 8).
9. **The Task board's cleanup and masonry cards, carried to other menus** (the "Menu cleanup" session). The Task board part is on main; Ideas, Settings › Providers, Plans, Vibe and the Project map are next, starting with a shared masonry helper. The owner asked for this (section 9).
10. **Void Engine Bot: fun, memory, release pings and model drops** (the "Discord community perks and verification" session). Built and mostly wired, parked on the bot's pushed branch `wip/bot-fun-memory` with 8 seam tests failing. The end-to-end test, a review and landing are left, and three sessions wait on it (section 10).

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
- **GPU and paint cost** ("In-app performance"): released. vibe.css, styles.css and the idle.js frame pacing are free. The parked fix touches only idle.js's brightness passes and tree-dynamics.js (section 7).
- **The bot repo** has a set order:
  1. "Discord community perks and verification" pushes its integrator commit first (chat, persona, memory, fun, releases, models-watch).
  2. Then the co-work session's `remote-dms` branch (in `C:\wt\veb-remote`, and parked on GitHub as `wip/remote-dms`; see section 2).
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

## 2. Home PCs that keep working, and reaching them from Discord

The owner's goal: home PCs keep working while they are away, and they check on
them and talk to them from Discord, like a Telegram bot, with Studio as the
main way. Their choices: **look + talk** powers, **DMs with the bot**,
**Telegram after Discord works**. The contract is `docs/remote.md`.

### Done, on main

- `39a153d`, **Start with Windows**:
  - Settings › General › Profile & startup, and the setup helper's Machine &
    app.
  - `--at-login` opens the last project in the tray, and the agents follow
    When Studio opens.
- `39a153d`, **Your PCs shows each PC's agents**: the sealed vault heartbeat
  carries `agentsSnapshot` → `vaultAgentsLine`.
- `5732ceb`, **the Discord remote, Studio side**:
  - `scripts/remote.cjs` holds the rules.
  - `scripts/hub-client.cjs` carries the `remote` frames.
  - main.cjs has a "Discord remote" block.
  - A message from Discord gets the chat gate; filed work is held with
    `origin.via = "remote"` in every mode, slices too.
  - Approvals from Discord need a PIN, and five wrong tries lock them.
  - Everything sent is scrubbed first.
  - The settings live in Friends › Your PCs › Reach this PC from Discord.

It does nothing until a hub carries the `remote` feature.

### Left, in order

**1. Land the bot side.**
- **Where it is:** branch `remote-dms`, commit `fa46910`.
  - It is built on GitHub's `61b1deb` and parked as `wip/remote-dms` on
    `nateecho32-stack/void-engine-bot`. It is not merged.
  - Its checkout on the laptop is `C:\wt\veb-remote`, with its own real
    `node_modules`.
  - The bot's `npm test` passes: 509 tests, up from 461.
- **What it adds:**
  - New modules `src/remote/{registry,service,discord}.mjs` and
    `src/commands/studio.mjs`: `/studio` is global and shows only in the bot's
    DMs.
  - The frames in `src/protocol.mjs`, and the wiring in `src/http/ws.mjs`.
  - A stand-in `onDirectMessage` plus `hub.dmRouters` in `src/index.mjs`.
  - DirectMessages in `src/discord/client.mjs`, only when `REMOTE_ENABLED`.
  - `REMOTE_ENABLED` requires `ROOMS_ENABLED`, and it lifts sockets per member
    from 3 to 8.
- **Wait for the persona push** from the "Discord community perks and
  verification" session. It brings the real `hub.onDirectMessage` /
  `hub.dmRouters` seam, with the persona as the DM fallback (`CHAT_DMS`).
  They will message the hash.
- **Rebase onto that push:**
  - Swap the stand-in for their seam.
  - Keep `hub.dmRouters.unshift(remoteDms.dmRouter)`.
  - A DM the remote takes must never reach the persona or its LLM. A test
    asserts this.
- **Merge the companion relay** ("Relay companion cards between Studios in a
  room") once the owner has pushed it. Expect small conflicts at
  `ready.features` in `protocol.mjs`, and at `sendReady`, the `attachWs`
  options and the unknown-frame branch in `ws.mjs`.
- **Push:**
  - Run `npm test` in the bot repo, then step 2 below, then push to main.
  - Delete `wip/remote-dms`.
  - Message "Build 4.5 roadmap". Its FH0/FH1 protocol-v2 slices rebase on
    top and carry the remote frames unchanged.
- **Choices the branch made:**
  - `/studio use` is remembered in memory only.
  - Only `status` fans out to every PC.
  - A late final reply still replaces the "did not answer" message.
  - Refusals to Studio: `tooManyPcs`, `remoteNotOn`, `unknownRequest`,
    `tooManyReplies`.
  - The remote works while the hub is paused.
  - 10 commands a minute per member, shared by `/studio`, DMs and buttons.

**2. Add the end-to-end test.** `tests/remote_e2e.test.mjs` is not written
yet.
- **Setup:**
  - Skip it unless `MEFI_STUDIO_BOT_ROOT` names a bot checkout that has
    `src/remote/service.mjs`.
  - Boot the bot's whole hub the way its `test/remote-hub.test.mjs` does:
    `createHub` with `ROOMS_ENABLED` and `REMOTE_ENABLED`, the fake Discord,
    and a fake fetch for `oauth2/@me`.
  - Drive it with Studio's real `scripts/hub-client.cjs`, as
    `tests/hub_e2e.test.mjs` does.
- **Cover:**
  - `ready.features` has `remote`.
  - `setRemote` makes `remoteState` list the PC.
  - A member's DM reaches only their own PC, and the reply edits the same
    DM.
  - `say` shows its interim reply, then the final one.
  - A PIN button round trip works.
  - A stranger's DM does nothing.

**3. Owner-only setup before it works.**
- **Push the bot's companion-relay commit.** It exists only on the PC that ran
  the three-account Friends test on 09-27. The 0.4.5 plan's FH0 asks for it
  too.
- **Hub PC:**
  - In `.env`: `ROOMS_ENABLED=true`, `REMOTE_ENABLED=true`, plus
    `STUDIO_APP_ID`, `ROOMS_CHANNEL_ID` and `HUB_SESSION_SECRET`.
  - Run `npm run register` once. The global `/studio` can take minutes to
    appear.
  - Restart the hub.
  - Set up a named cloudflared tunnel so the address stays stable.
- **On each PC:**
  - Enter the link app id and the hub address in Settings › Community ›
    Connection details, then Link Discord.
  - Turn on Start with Windows.
  - Turn on Friends › Your PCs › Reach this PC from Discord, name the PC, and
    set a PIN.
  - Add the second Claude subscription under Setup › Connect an AI › More than
    one login. The laptop's Studio has only the main login
    (`settings.cliAccounts` is empty).
- **In Discord:** allow DMs from server members, so alerts can arrive.

**4. Subscriptions first.**
- **The owner's direction:**
  - Use cheap models first on subscriptions (Haiku, or the cheapest decent
    one).
  - Really use the subscriptions, and move up a model or effort level only
    when a task really can't be done.
  - Record when a better model or effort worked, and feed it into Jev.
  - Log every call with its estimated cost and input/output tokens.
  - This overrides the earlier Zen picks for the chat, scout, lead and desk
    seats. Zen stays as their fallback.
- **Blocked:**
  - It waits for the 0.4.5 slices S12 and S14a (section 1's table,
    `C:\wt\s12-cli`). S12 is `scripts/cli-stream.cjs`: Claude `stream-json`
    and Codex `--json`, with usage `{input, output, cacheRead, cacheCreate}`.
    They paused at the usage limit, uncommitted, before their tests. Land
    them first, or build the ladder on top of them in the same worktree.
  - Until then, leave these alone: `seatFetch`, `cliAssistantCall`,
    `httpAssistantCall`, `requestBody`, the agent-tools run loop,
    `usage-tracker.cjs` and the `executor-core.cjs` command lines.
- **What the code does today:**
  - **No effort flag reaches any CLI.** Claude Code 2.1.280 has
    `--effort low…max`, `--fallback-model` and `--max-budget-usd`. Codex takes
    `-c model_reasoning_effort=…`, and OpenCode takes `--variant`.
  - **Claude builders only get `--model`.** The tiers are `fast` = sonnet and
    `heavy` = opus (`executorTierDefaults`).
  - **Retries reuse the same model.** The only step up is the owner-gated
    "retry-deep" (`heavyRetryRoute`, Heavy tier, once). `autonomy.classify`
    files it as "pricier-model", which goes to the owner by default.
  - **`recordWorkerAttempt` stores no effort, tokens, cost or
    `escalationOf`.** The fields already exist in `model-performance.cjs`,
    which also has `nextEffort()`.
  - **Routing never chooses among Claude models.** Jev and the local
    posterior only pick among z.ai and Go models.
  - **Sessionless Claude builds never settle a win or loss.**
  - **Claude's `total_cost_usd` is lost.** It arrives as `equivalentUsd` and
    is then dropped by `cliAssistantCall`; the ledger has no field for it.
    Claude builders run with `--output-format text` and log no tokens.
  - **A Claude seat already works:**
    `agentSeats.<seat> = {provider:"claude", model:"claude-haiku-4-5"}` runs
    through `seatFetch` → `cliAssistantCall`. Effort cannot be set for a
    Claude seat yet (`agent-profiles.validate` refuses it).
- **The plan:**
  - Write a pure `scripts/model-ladder.cjs`. The rungs are
    `claude-haiku-4-5` ($1/$5, no effort), then `claude-sonnet-5` ($2/$10,
    effort low → high), then `claude-opus-5-5` ($4/$20, cache read $0.20,
    default effort medium). `claude-fable-5-1` ($10/$50) is owner-gated.
  - Prices are per million tokens. A cache write is about 1.25× input and a
    read about 0.1× (claude-api reference, cached 2026-06-24).
  - Step up on a charged failure or a rejected verification. Record the
    model, the effort asked for and applied, `escalationOf`, the tokens and
    `equivalentUsd` from S12's usage.
  - Learn per task type as `model@effort`, so the next similar task starts at
    the rung that worked.
  - Confirm with the owner that the owner gate covers only Opus, Fable and
    `max` effort.
  - Show the estimated equivalent cost of subscription calls in Usage.

**5. Later: Telegram.**
- Link a Telegram chat to the Discord member with a one-time code that Studio
  shows. The bot then relays into the same remote service (`docs/remote.md`,
  step 5).
- The owner's "bridge one channel between a friend's server and Telegram"
  idea would be a separate bot feature.

### The rest of the owner's list: who has it

- **A log book agents can read and write:** the 0.4.5 plan's Work Journal and
  `studio_history` tool (A1–A3, "Build 4.5 roadmap"). "Message this agent" is
  still unbuilt, in `docs/fleet-overhaul-plan.md` Phase 3.
- **Seeing what is being made:**
  - Done: the Your PCs agent lines, and `/studio made` for the remote.
  - Still to come: live progress (0.4.5 A7).
- **Less memory, so more agents can run.** Not started. Known so far:
  - A new worker needs 440 MB free, and the laptop sits near 0.5 GB free.
  - The board's `contextHistory` is the bulk of it; 0.4.5 A2 cuts it.
  - The per-worker budget was never measured for Claude or OpenCode.
- **Easier setup:**
  - Onboarding landed (`6a5c7be`).
  - A second PC still takes about 12–15 steps.
  - The vault carries neither CLI logins nor seats.
- **Long term:** extensions (a game engine framework, a Discord bot
  framework), app sharing with points spent on ads, and sponsorship for
  hosting. These are roadmap only. Guard rails:
  - Discord bans invite rewards.
  - Points must never turn into cash.
  - Subscription logins are never shared or resold. Sponsorship can fund
    metered keys and hosting only.

### Who else is in these files

See section 1, "Held by other sessions", including the order for the bot
repo. The persona push from "Discord community perks and verification"
comes first there, and `remote-dms` rebases onto it.

### Cleanup

- `C:\wt\veb-remote`: keep it until `remote-dms` is merged. Its
  `node_modules` is a real folder, not a junction.
- The laptop worktree `C:\wt\away` and its preview entry
  `away-pcs-line-preview` in `.claude/launch.json` were removed with this
  handoff.

## 3. Left for the owner: Batch 3, one page frame

The menu polish pass is on main. The "Continuing fixes" session finished it in six commits, from "One two-step confirm and one plain error sentence for every menu" to "Rooms: plain connection errors, two-step Close, Leave and Delete".

The tab pages (Performance, Usage, Context, Model catalog, Settings, Activity) sit in a centred column at most 1,560 px wide, with the 84 px tree strip (`#tree-rail`) at the right edge. The sheets use a full-width 64 px header band. The plan was to:
- hide `#tree-rail` outside Command and drop its padding (`styles.css` `--rail-gap`, section 10);
- give the tab pages and Agent brain the sheets' header band and content edge;
- keep one Settings category nav (Appearance swaps to pills today).

It wasn't done, because the first step contradicts a pinned contract: `tests/fixtures/command-render-electron.cjs` asserts "visible rail resumes painting" on the Model catalog page.
- Decide whether the tree strip should stay on tab pages. If it goes, change that assertion with it.
- Either way, capture before and after (the seeded fake-bridge preview at 1920x1080).
- Leave `styles.css` ~4833 (the `data-nav-section` padding) and the `studio-ui.css` `@media (max-height: 600px)` rail block alone.

Remove this section once that is decided, and delete the file when every section is done.


## 4. The website rebuild (not published)

The owner asked for this (2026-09-28):
- Repolish and upgrade the public site (restyle freely), community first, simple, with a solid
  design built from normal web page elements.
- A page listing everything in Studio.
- A roadmap showing Done, Being worked on and Planned, with ways to request features on GitHub or
  in the Discord.
- The owner's community plan, shown as Planned:
  - share ideas and projects;
  - earn credits for playing or looking at others' projects, and spend them to advertise your own;
  - cosmetics and creator styles for credits;
  - shared mixes, with most-played lists for people who turn on "share music taste".
- The wiki brought up to date.
- Live now, without waiting for 0.4.5. The download stays on 0.4.4.

### Where it is
- **Branch `wip/site-rebuild`** (pushed; based on `gh-pages` 3fdf4b9). On this PC it is checked out
  in the worktree `C:\wt\site`. On another PC:
  `git worktree add C:\wt\site origin/wip/site-rebuild`, then `git switch -c wip/site-rebuild`.
- GitHub Pages publishes only `gh-pages`, so the old site is still live. Nothing on the branch has
  been checked yet.
- **`_handoff/` on that branch** holds everything the next session needs:
  - `owner-and-roadmap-input.md`: the request, the labelling and honesty rules, the roadmap in plain
    words, the website ideas and the verified facts. **Read it first.**
  - `partials.html`: the shared header, phone menu and footer markup, plus the component catalogue.
  - `stage1/*.json`: the research.
    - About 420 features, each with a status and evidence (`features_completeness.json` adds 21
      and fixes 13 statuses).
    - The roadmap, the site audit, page-by-page wiki audits and the community facts.
  - `capture-site.cjs`: an offscreen screenshot tool. It serves the folder on 127.0.0.1 and writes
    full-page and segment PNGs plus `report.json` (console errors, 404s, overflow). Run:
    `"<app>\node_modules\electron\dist\electron.exe" capture-site.cjs --root C:\wt\site --out <dir> --pages index.html,roadmap.html,wiki/index.html#/vibe-mode --widths 1440,390`

| File | State |
| --- | --- |
| `assets/site.css`, `assets/site.js` | Done: the new design system (tab bar with gliding active tab, phone menu, view transitions, footer, status badges, roadmap board and timeline, live Discord pulse, tabsets, FAQ, request band, most-wanted requests by 👍) |
| `index.html` + `home.css`/`home.js`, `features.html` + css/js, `community.html` + css/js + `showcase.json`, `download.html` + css, `404.html` | Partial: written by agents that stopped before their visual and fact checks |
| `assets/roadmap.json` | Written; needs updating (step 1) |
| `roadmap.html`, `roadmap.css`, `roadmap.js` | **Missing** |
| `wiki/index.html`, `wiki.js`, `wiki.css`, `wiki/pages.json` | Partial: the new structure lists 13 pages that don't exist yet |
| 13 new wiki pages | **Missing**: setup-helper, coming-in-0-4-5, vibe-mode, permissions, agent-brain, trace, settings, friends-and-rooms, your-pcs, companion, media-player, discord, appearance |
| 21 existing wiki pages | **Not updated**. The audits in `stage1/wiki_*.json` list every fix |

### Finish in this order
1. **Roadmap page.** Build `roadmap.html`, `roadmap.css` and `roadmap.js`, rendering `assets/roadmap.json`:
   - three lanes: Done (with a release timeline), Being worked on, Planned;
   - area filters and a details disclosure on each item;
   - a `<noscript>` fallback;
   - "Ask for something": the GitHub feature template and the Discord, plus Most wanted from
     `SITE.fetchFeatureRequests(6)`.

   Update the JSON first: main moved after the research (`git log --oneline v0.4.4..origin/main`).
   - Built since, so "Coming in 0.4.5": 704ef0d, 39a153d, 6a94370, 16544dd, 5732ceb and anything
     newer.
   - Section 1's 0.4.5 work has started (faster sends, logging, load times, Friends 2.0), so show
     those items as In progress, with the paused state that section 1 records.
2. **Wiki.** Write the 13 new pages and update the 21 existing ones. The guide documents 0.4.4;
   mark newer behaviour with `<span class="status next">Coming in 0.4.5</span>`, and link to
   `../roadmap.html` for planned things.
3. **Check each page** at 1440 and 390 wide. **Fact-check every claim** against main and
   `stage1`. These facts are easy to get wrong (all in `owner-and-roadmap-input.md`):
   - **Updates in 0.4.4 don't install.** An in-app update never finishes installing, so the
     download page must give the manual steps: extract to a new folder and copy the old
     `resources\app\data`. Settings and keys carry over from `%APPDATA%`.
   - **CLI sign-in in 0.4.4.** The guided CLI setup windows may close at once, so sign in from a
     terminal.
   - **Rolling out, not Coming in 0.4.5:** playdates with friends, "Share back?" and Rooms. They
     need the owner-run hub.
   - **Credits.** They are earned only, never bought, never for inviting people, and never tied to
     Discord activity. Never mention invite rewards.
4. **Link and accessibility sweep.** `report.json` must show zero console errors, zero 404s and no
   overflow, and every internal link and wiki slug must resolve.
5. **Clean up.**
   - Delete `_handoff/` and the unused `assets/launch.css`.
   - Decide on `media/mefi-work-in-motion.mp4` and `assets/shots/friends-panel.webp`, which no page
     uses.
   - Update the branch `README.md` (the new pages, and how to edit `roadmap.json` and
     `showcase.json`) and `docs/public-site.md` on main.
6. **Publish.** Check that `origin/gh-pages` is still 3fdf4b9, fast-forward it
   (`git push origin HEAD:gh-pages`), then load the live site.
7. **Then land `wip/issue-links` on main** (pushed, one commit). It adds the roadmap and the Discord
   to GitHub's "New issue" chooser, and a check-the-roadmap / 👍 note to the feature template. It
   links to `roadmap.html`, so land it only once that page is live. Rebase onto main, run
   `npm run check`, then push.

### Also open for the owner (from the "Continuing fixes" session)
- **Old logs:** don't delete `tools/logs` (about 966 MB inside OneDrive). The logging rework in
  section 1 (S18) archives it, and the owner decided nothing gets deleted. The five one-off root
  `*.log` files can go with it.
- **Release workflow:** run `gh auth refresh -s workflow` so `release.yml` can be fixed (hosted
  Windows runners fail four render fixtures), unless section 1's list already covers it.
- **`docs/friends-setup.md`** already tells people to update to 0.4.5.

## 5. Model tracker, community model ratings and probes

Written 2026-09-28 by the session "Discord bot model feedback integration".
It covers Studio and the Void Engine Bot. Both halves are pushed as `wip/`
branches, so any PC can pick them up.

### What the owner asked for

- **A #model-reviews forum.** The bot runs it by itself, in its own embed style. Members rate models per task and post tips.
- **Evidence over mood.** Ratings feed Studio's model picks from real use, never from how people feel.
  - Read the provider's release notes first.
  - Otherwise break comments down into task kinds: planning, structuring, writing, commits, tests and setup.
  - Probe tests Studio can run.
- **An updated model tracker.**

The owner chose:
- the feed published as public JSON on gh-pages;
- a forum with one post per model;
- LLM analysis of comments under a daily cap;
- probes that run on demand only.

The contract between the two repos is `docs/model-community.md` on the Studio branch.

### 1. Studio: done and gated, but not on main

- **Branch:** `wip/model-community` on origin (`a7e6294`), in the worktree `C:\wt\mc`. It is one commit on `39a153d`.
- **Contents:**
  - The model tracker refresh: `data/curated.json`, `data/models.json`, and `providerModels` in `refresh-models.mjs`. The catalog's "Also tracked" list is in `booklet.js`.
  - Feed ingestion: `scripts/model-community.cjs`.
  - The probes: `scripts/model-probes.mjs`.
  - The routing prior: `model-routing.mjs`. Community evidence moves it at most ±0.05 and probes at most ±0.10.
  - Models › Performance › Community: `renderer/model-community.js`.
  - IPC `models:*`.
- **Gate (at `a7e6294`):**
  - `build-booklet`, `check` (192 targets) and `audit` (0 findings) pass.
  - In `npm test`, the Python contracts and the path lock pass. The Node suites pass except `command_render`, which failed with "Assistant narrow: pointer reaches the switch track" and passed when rerun alone. That makes it the known flake.
- **To land:**
  1. Rebase onto the current `origin/main`. `b52a09c` and `5732ceb` touch `main.cjs` and `preload.cjs` (the Discord remote), so expect conflicts there and in `CHANGELOG.md` (keep both sides).
  2. Run `npm run build-booklet`, `check`, `audit` and the full `npm test`.
  3. Add a TESTRUNS row with `scripts/append-testruns-row.mjs`.
  4. Run `git push origin HEAD:main` from the worktree.
  5. Delete the `wip/model-community` branch.
  6. `rmdir C:\wt\mc\node_modules`, then `git worktree remove`.
- **Heads-up:** the bot's "New in Studio" diff will announce the six new Go models in one digest once this reaches main. The perks session knows.
- **Known limits:**
  - Cancel doesn't abort the probe call already in flight.
  - Probe results for the Claude, Zen and Codex routes show in the UI only, because routing compares z.ai and Go models.
  - The feed's `probeIdeas` aren't turned into probes yet.
  - The catalog still carries the Go plan-wide $12/$30/$60 windows, which the docs no longer publish, because `usage-tracker.cjs` reads them.

### 2. Void Engine Bot: built and tested, not documented or wired

- **Branch:** `wip/model-reviews` on the bot's origin (`e7c8e95`), in the worktree `C:\wt\bot-reviews`. It is based on `61b1deb`, and `npm test` gives 506 pass.
- **Contents** (new files only):
  - `src/models/*`: kinds, config, tables, catalog, ratings, claims, analyze, docs, embed, forum, forum-api, feed, service, privacy, autocomplete.
  - `src/commands/rate.mjs` and `tip.mjs`.
  - `config/model-docs.json`: the release-notes allow-list. Check that its URLs are live.
  - Six `test/models-*.test.mjs` files, plus fakes.
- **Where it stopped:** the builder hit the usage limit before writing `docs/model-reviews.md`, a copy of the contract from the bot's side with a **Wiring** section. The full brief is in the session scratchpad `bot-reviews-prompt.md`, which exists on this PC only. Its main points are above.
- **Next:**
  1. Wait for the session "Discord community perks and verification" to push the bot repo. It holds uncommitted `models-watch`, releases, persona, chat and fun work in the main checkout, plus an integrator pass.
  2. Rebase `wip/model-reviews` onto that push.
  3. Wire it:
     - add `MODEL_REVIEW_TABLES_SQL` as a store migration;
     - add `MODEL_REVIEWS_FORUM_ID`, `MODEL_ANALYSIS_DAILY_CAP`, `GITHUB_FEED_TOKEN` and `MODEL_FEED_PUBLISH` to `config.mjs` and `.env.example`;
     - register `/rate` and `/tip`;
     - route `messageCreate` for forum threads;
     - add a scheduler job for the feed publish (at most every 3 h, only when the hash changes);
     - call `forgetModelReviews` from `/forget-me` and update the `/privacy` text;
     - mount `registerModelCommunityRoute` on the hub;
     - add ratings to the chat `facts` provider.
  4. Write `docs/model-reviews.md`, and update the privacy doc, runbook and README.
  5. Run `npm test`, commit, and push to the bot's main.
- **Other session:** "Build 4.5 roadmap" plans hub FH0/FH1 changes (protocol, ws, rooms). It has been told which files this touches.
- **The owner sets up:**
  - the #model-reviews forum channel and its id in `.env`;
  - the Message Content intent;
  - a fine-grained GitHub token with Contents read/write on `mefi-studio` only, pasted into the bot's `.env` by the owner;
  - a bot restart.

## 6. Build as a coding-agent desktop (branch `wip/builder-mode`)

The owner asked, with a screenshot of the Claude Code desktop app, for Build mode to manage work the way Claude Code and Codex do, with windows that pop in and out when needed. Vibe should become the social mode, and Home should bring Vibe back.

**Where it is.** Branch `builder-mode`, pushed as `origin/wip/builder-mode` (`dfc0891`, one commit on `704ef0d`). The worktree is `C:\wt\builder` on this PC; its `node_modules` is a junction, so `rmdir` it before `git worktree remove`. Nothing is on main, and nothing has been run yet: not `check`, not `npm test`.

**What is built.**
- **Menu** (Build mode, rail shell): a Vibe | Build switch on top (Vibe has the home glyph), then the project's tasks listed like sessions: Chat with Mefi, Pinned, Needs you, Working, then the rest by the day each last moved, with status dots and a filter. Your name and what needs you sit at the foot.
- **New task page:** "What's up next, <name>?" over a stats card with Tasks, Runs, Total tokens, Active days, Peak hour and Top model, a 22-week heatmap, a Models tab and All / 30d / 7d ranges.
- **Task sessions:** the brief, every run and what it said, Mefi's notices, live output, open questions with their answer buttons, and a composer for a Note (the next run reads it), Ask (Mefi answers inline) or Change (a linked follow-up task).
- **Composer chips:** project, branch with its uncommitted count, a Worktree switch, the permission mode, and the coding worker with its tier.
- **Panes:** Activity, Output, Checks, Preview, Queue and Status dock beside the page, or pop out as windows you can move and resize. Drag one off the dock to pop it out, and back over the dock to dock it.
- **Code:**
  - New files: `renderer/panes.js` (`MefiPanes`), `renderer/builder.js` (`MefiBuilder`), `renderer/builder.css` and `scripts/work-stats.cjs` (pure).
  - Host: `work:stats`, `work:where` and `work:worktrees` in main.cjs after `usage:task`, exposed in preload as `workStats`, `workWhere` and `workWorktrees`. `codingSessionUsage(now, days)` takes a reach, and `executor-worktrees.cjs` gained `prefer()` for `settings.executor.worktreeRuns`.
  - Hooks: nav.js `renderRail` calls `MefiBuilder.decorateRail`, and `paintRecentTasks` defers to `MefiBuilder.paintRail`. workspace.js gained `snapshot()`, `setComposerMode` and the `mefi:workspace-state` event; its `composeTask`, `openTask` and `requestChange` go to the builder while it is active.
- **Layout switch:** `mefiStudio.homeLayout` (`sessions` | `classic`), the `?home=` parameter, and Search's "Switch Home layout" (it reloads). `?capture=1` and `?smoke=1` keep the classic Home, so the Electron fixtures still see the page they pin. Closed panes wait in a hidden `.pane-shelf`, so Home's own code still finds their parts by id.

**What is left, in order.**
1. **Gates.**
   - Rebase onto the current `origin/main` first. The Discord remote and the 0.4.5 slices change main.cjs and preload.cjs near the new handlers.
   - `tests/booklet_build.test.mjs`: add `panes.js` and `builder.js` to `INLINE_SCRIPTS`, and `builder.css` to the stylesheet loop. `tests/module_purity.test.mjs`: add `scripts/work-stats.cjs`.
   - New tests: work-stats (ranges, the heatmap window, model names read from `via`, tokens), the builder's grouping (fake DOM), and the panes (dock, float, close, shelf).
   - Run `check` (`check-css --unused`, the auditor), `audit` and the full `npm test`; rebuild and commit `renderer/booklet.html`; add a TESTRUNS row, `docs/code-map.md` rows, Getting around in `docs/architecture.md`, and a CHANGELOG entry.
2. **Fixes seen at 1920x1080.**
   - The composer's bottom row wraps: the tier picker and Send drop to a second line. Fold "Use a task outline" and "Plan an idea" into a "+" menu, or let the tier chip shrink.
   - The Start here invitation sits under the stats card on New task. Decide whether it belongs there.
3. **Vibe as the social mode.** Not started.
   - Cards that mount into any container: `MefiCompanionFriends.card()`, `MefiRooms.panel()` (call `dispose()` on removal) and `MefiPcSync.card()`, which includes the vault sections. Counts: `MefiRooms.pending()`, `MefiPcSync.badge()`, `MefiTogether.status().session`, `MefiMusic.status()` and `MefiCommunity.status()`.
   - Each card is single-instance (fixed ids), and the companion hub's Friends bubble mounts the same ones. Listen together paints only inside the music dropdown (`MefiMusic.togetherHost()`).
   - Friends 2.0 (section 1, wave 3, FS3) plans a Friends section: build on it rather than beside it. `vibe.css`'s glass tokens are free now (section 7).
4. **Ask the owner.**
   - Does Vibe keep its Build it box and work cards, or go social-first with work as one compact card?
   - The Worktree chip turns per-run worktrees on from the UI. The module's header says they stay opt-in "until the owner flips the default".
   - The worker and tier pickers save through `setAiRouting`, which copies the defaults into a Project team when the project inherits them.
   - Should sessions become the only Home? Then the Electron fixtures that pin the classic Home need rewriting; `workflow-render` pins the pinned rail at 256 px, and the sessions layout uses 272.

**How to look at it.** Use the seeded fake-bridge preview (a copy of `website/tools/screenshots` `make_preview.cjs` and `capture.cjs`, offscreen Electron at 1920x1080) with extra seeds for `workStats`, `workWhere`, `tasksAttempts` and `getAiRouting`. On this PC the copy is in the scratchpad of Claude session c568012b (`shots/`).

Remove this section once the branch lands and the owner has answered.

## 7. In-app performance: tree brightness costs the GPU (parked on `wip/tree-brightness-gpu`)

The owner asked for smoother in-app performance. The main cause is found and a fix is written. It is not
landed yet, because it changes how the brightened tree looks in places (item 1 below).

### What makes it choppy

- **The owner's look:** Atmosphere with glass and glow at 100, Singularity, helix, orbit trails, extra
  glow, the deep-space sky, and **Tree brightness at 200%** for nodes and lines, with outlines on
  (Appearance › Tree brightness & outlines, saved in `mefiStudio.treeDynamics.v1`).
- **The result:** the laptop's integrated GPU (Radeon 860M) runs at 98–100%. Vibe draws about 4.6 fps,
  Command 8.8 and Home 4.1, because the tree draws under all three. Scripts take about 13 ms a frame;
  the rest is waiting on the GPU.
- **The cause:** `MefiTreeDynamics.beginPaint` sets `ctx.filter = "brightness(2)"` around the whole
  wires and nodes passes (idle.js `drawGraphConnections` and the node loop). Chromium draws every shape
  made under a canvas filter through its own layer the size of the canvas.
- **What was ruled out:** node brightness is most of the cost and line brightness some. Outlines cost
  almost nothing. Turning off Vibe's aurora, its glass blur or its animations changed nothing.
- **A side effect:** at that speed the detail governor (`state.frameCost`, which counts JS time only)
  holds nodes at tiers 1–2, so the owner has been seeing simplified nodes.

### The fix so far

- **Where:** `wip/tree-brightness-gpu` (`a3789e4`, on `6c1c940`; worktree `C:\wt\perf` on the laptop).
- **How:** idle.js `toneBegin` paints each pass plain into a scratch `OffscreenCanvas` per layer. One
  filtered `drawImage` then lays it down. The scratch starts with its layer's drawing state and hands
  back the state the pass left. tree-dynamics.js exports `brightness(kind)`; `beginPaint` is unchanged.
- **Measured** in the probe below: Vibe 42 fps (GPU 50%), Command 36 (37%), Home 43 (20%).
- **Tests:** 211 pass (tree_dynamics, command_graph, command_audio_response, command_visuals,
  command_node_tree, command_director), and `npm run check` passes. Not run yet: `npm test`,
  `npm run audit` and the Electron fixtures (tree_dynamics_render, command_render, node_paint_cache).

### Left, in order

1. **Draw outlines outside the brightened layer.** Brightness at or above 100% leaves black and white
   unchanged. With a filter per shape, a node's colored rim over its black outline therefore stayed
   washed-out white. In one shared layer the rim comes out gold or teal instead. At brightness ≥ 1:
   - Draw `MefiTreeDynamics.outline` (called at the top of `drawNodeSurface`) on the real layer.
   - Before an outline that overlaps nodes already in the scratch, flush the scratch: composite it,
     then clear it, clipped to the pending area. A front node's ring then stays above the nodes
     behind it.
   - Below 100%, keep outlines in the layer. Nothing clamps there, so the result is exact.
   - In a probe experiment this dropped the pixels that differ by more than 8 levels from 0.71% to
     0.15% (at equal detail tiers).
2. **Ask the owner about the rest.** At 200%, small colored accents over dark cores keep more of their
   color: Singularity's crescent, the progress meter's fill, glyph edges. Exact per-shape results
   would need either of these:
   - Pre-brightened paints. Solid colors are exact. Gradients are exact with a stop added at each
     clamp point, since canvas gradients interpolate unpremultiplied. Sprites become brightened
     copies.
   - Per-shape filters inside node-sized clips.
3. **Finish and land.**
   - Add a `toneBegin` test: filters go back to `none`, and the pen state is handed back (`lineCap`
     after the wires pass).
   - Run the full gates, and add the docs/performance.md, CHANGELOG and TESTRUNS entries.
   - Rebase onto main. `704ef0d` changed idle.js elsewhere, with no overlap.
4. **Check the owner's live app.** `tools/profile_live_studio.mjs` refuses it, because the live window
   loads `dist\Mefi Studio AI+\resources\app\renderer\booklet.html`, not the repo's booklet.

### How to measure

`tools/perf-probe` on the branch is scratch tooling, not meant for main as it is. It opens a seeded
fake-bridge booklet in a hardware-rendered window placed off every display. It samples frames, long
animation frames, and CPU and GPU 3D use per process, and it diffs screenshots.
- **Pages:** `node tools/perf-probe/make_probe.cjs <booklet.html> data/models.json
  tools/perf-probe/look.json <pages>\fix1.html`, plus `base.html` from
  `git show 6c1c940:renderer/booklet.html`.
- **Run:** `powershell -File tools/perf-probe/run.ps1 -Plan tools/perf-probe/plans/before-after.json
  -Pages <pages> -Out <scratch>\result.json`.
- `look.json` is the owner's look without their links or other personal data.

### Next levers after this

- At 100% brightness, Vibe still costs about half the GPU, and the GPU process uses 1.3–1.7 cores. The
  aurora's `blur(90px)` with `mix-blend-mode` sits under about ten `backdrop-filter` panels, over the
  live tree.
- The detail governor sees JS time only, so it can't tell when the GPU is the bottleneck.

### Not the app

While this was measured, the laptop had about 400 MB free, with 44.8 of 47.2 GB committed. It was paging
about 25,000 pages a second, and 42 `claude` processes held 13.8 GB. Every app stutters under that,
and closing idle sessions helps more than any code change.

This work no longer holds `vibe.css`, `styles.css` or the idle.js frame pacing. Remove this section
once the branch lands and the owner has answered item 2.

## 8. Media player redesign: on `wip/media-player-redesign`, not landed

**The owner's ask (2026-09-28).** A smaller hover dropdown that grows as you go deeper. Play, pause, back, forward and a volume slider. Quick switches for the node tree's visuals. A docked YouTube video that moves smoothly when the box scrolls (it jittered). A better-looking menu. An easy way to scroll through YouTube videos without the full website: click one to add it, or drag it into the queue "if it's your own or nobody is queued behind you".

**Where the code is.** Commit `79ea63f` on `origin/wip/media-player-redesign`, based on `39a153d`. The worktree `C:\wt\media-player` (with a `node_modules` junction) is on this PC only.

**What's in it:**
- **The menu is a mini player** (`renderer/music.js`, `renderer/music.css`), 396 px wide under the toolbar button. It holds:
  - a header with a Music / Radio / Video switch, Unfold and Close;
  - the video's stage, then the title, channel, seek bar, previous / play-pause / next, mute and volume;
  - eight quick tree switches: React (the audio link), Waves, Glow, Motion, Drums, Aura, Trails and Halos;
  - an "Up next" line and section chips.
- **It unfolds** (an eased resize, `morph()`) into one section beside the card: Browse, Picture, Tree and More for video; Tracks for local files; Stations for radio. Every visit starts folded.
- **No more jitter.** `renderer/media-window.js` carries the whole player into the card's stage with `moveBefore()`, a state-preserving move, instead of a floating overlay chased by JavaScript. The docked player hides its own bar; a docked website gets `clip()`; a floating player steps clear of the open menu with `avoid()`.
- **One transport for every source**, both in the card and on the floating player's bar:
  - local files and radio (previous / next station);
  - YouTube and Vimeo through their message APIs, which also supply the real title, channel and length;
  - plain video files.
  - Back restarts, or goes to the link played before. Volume reports that echo Studio's own change are ignored for 1.5 s.
- **Browse** is one box: words search YouTube, and a link plays. It shows "More like this video" for the playing video and scrolls without end. `scripts/youtube-explorer.cjs` now answers `{ related }` and `{ more }`: pages come through `youtubei/v1` search and next; only tokens it issued are accepted; a new request replaces the old one. Each card shows a thumbnail, and the template's CSP `img-src` gains `https://i.ytimg.com`.
  - A click queues the video, or plays it when nothing is on.
  - Drag a card onto Up next to place it, or onto the card to play it. Drag Up next rows to reorder them.
  - Cards are marked "In Up next" or "Playing".
- **Smaller changes:** passing notices fade after 7 s. `MefiMusic.openSection()` is new, and companion-hub's "Friends & listening rooms" opens More, where Listen together now lives. `tools/media-probe/` holds the offscreen probe.

**Verified** with `node tools/media-probe/probe.mjs <checkout> <outDir> after probe-after.cjs` (1920×1080, a fake YouTube embed that speaks the widget protocol, a stub search):
- the player docks with one provider load and drifts 0 px on every frame while the card scrolls;
- pause, seek (a preview while dragging, final on release) and volume reach the embed;
- Browse loaded related videos and two more pages (12 → 36 cards);
- click-to-add, drop at the top and drag-to-reorder all work.

The live explorer was also called against YouTube: search pages of about 20, and related pages of 26 and then 40.

**What's left:**
1. **Update the tests to the new contract.**
   - `tests/music.test.mjs`: 10 tests fail.
     - `music-radio-volume`, `music-link-volume` and `music-link-mute` become `music-volume` (a 0–100 scale) and `music-mute`; `music-link-next` becomes `music-next`.
     - Search types into `music-link-url` and clicks `music-link-load`; `music-youtube-query` and `music-youtube-search` are gone.
     - Advance the clock 1.5 s before a YouTube volume report that should be adopted.
     - The box clears after Add to queue, so set it inside the 55× loop.
     - The tabs are in the header now, not `sound.children[2]`.
     - Reveal local controls through `music-add-files`, and radio through `music-radio-state`.
     - On hover the card starts at the top, with no 142 px scroll.
   - `tests/media_window.test.mjs`: 2 tests fail. Docking is `dock(element)`, so the fake `Element` needs `moveBefore` and `getBoundingClientRect`.
   - Rewrite `tests/fixtures/media-window-render-electron.cjs` and `tests/fixtures/media-browser-electron.cjs`. They measure the old 1,080 px panel. Check `aria-pressed`, not the "Return to player" text, and note that a website now widens the card (`data-shape="browser"`).
   - Add tests for:
     - the transport per source and the quick switches;
     - sections and unfolding;
     - feed paging, marks and drops (`queueDropIndex`, `moveQueued`);
     - the explorer's related, more, forged-token and superseded paths.
2. **Gates and records.** Run `npm run build-booklet`, `check`, `lint` and `audit`, and the full `npm test`. Add a CHANGELOG entry, a `docs/code-map.md` line for each touched file, and a TESTRUNS row.
3. **Land it.** Rebase onto `origin/main`, gate the exact commit in the worktree, and push fast-forward only (`git push origin HEAD:main`), as in section 1's recipe. The "Menu text input behavior" session's `data-type-scope` lines are already on main and carried into the new layout. The Browse box is `[data-type-here]`, and typing on the folded card opens Browse.
4. **Decide with the owner:**
   - **The "your own, or nobody behind you" rule.** Up next is personal today; there is no shared queue yet. That rule belongs to the fair room queue in the 0.4.5 plan: FH2 and FH4 on the hub, FS5's `renderer/room-queue.js` in Studio (its jump and box rules, section D). Dragging into a room queue should follow those rules.
   - **SoundCloud and Spotify** keep their own play buttons (Studio's is disabled for them). SoundCloud's widget API could be wired later.
   - **Titles for links queued by URL.** They read "YouTube video" until they play. oEmbed, or the hub's metadata (FH3), could fill them in.

## 9. Menu cleanup: the Task board's pattern on other menus

On main: "Clean up the Task board" and the masonry follow-up (`renderer/tasks.js`, the task-board block in `renderer/styles.css`, `#tasks-overlay` in the template). The owner liked it and asked where else it fits. Two ideas carry over separately:
- **Declutter.** Tools come first: add, then search with the state picker on the same row, then segmented chips. No explainer paragraphs. The whole card opens on a click or on Enter, the open card is ringed, "← All cards" shows at every width, and the status box appears on Details only.
- **Masonry.** Styles give a grid 4px rows (`grid-auto-rows: 4px; row-gap: 0`). `layoutMasonry`/`watchMasonry` in tasks.js span each child to its height plus the 12px gap, and a ResizeObserver keeps the spans right. Cards that move glide for 260 ms unless `MefiMotion.off()` or reduced motion. A card with no span yet appears without a glide.

Order of work:
1. **Make masonry a shared helper,** e.g. `MefiMotion.masonry(list)` in `renderer/motion.js`, and have tasks.js call it. Keep these behaviours: spans clear when the CSS rule is off, and the code is guarded with `typeof`, because the vm suites' fake DOM has no `ResizeObserver`, `getComputedStyle` or `requestAnimationFrame`.
2. **Ideas sheet** (`#ideas-overlay`) needs the declutter pass. Drop the "Unread" heading and bring the Tools menu's actions forward. Idea rows should open on a click. The "Selected idea" pane and "Back to ideas" should work like the Task board detail. Use masonry if ideas become cards.
3. **Settings › Providers** (`.provider-grid`, styles.css ~4010) needs masonry only: expanded tiles leave holes.
4. **Plans** (`.planning-map-columns`, `.planning-existing-grid` in planning.css). Read 16544dd "Plans face lift" first. The declutter may already be done, which leaves only masonry.
5. **Vibe and the Project map** need masonry only: `.vibe-lanes` and `.vibe-evolution-suggestions` (vibe.css; vibe.css also has the "In-app performance" session's glass edits, so coordinate with it), and `.pm-idea-branches` (agent-brain.css).
6. **Optional:** the Task board detail tabs are still busy (the Prerequisites fold, handoff and brief history, the delegated-subtasks block). The owner hasn't asked for this.

Pins to know:
- `tests/tasks_ui.test.mjs` pins card text ("Current step" + "Working on: …", "1/2 confirmed (50%)"). Status-row buttons must stay direct children of `#task-status-row`.
- `tests/fixtures/workflow-render-electron.cjs` returns Home through `#app-task-context button` and checks `.task-overview-card.opens-task`.
- For captures, use `tests/task_overview_render.test.mjs` with `MEFI_TASK_OVERVIEW_CAPTURE_DIR=<abs dir>`. For 1920x1080, copy the fixture, change the window size, and switch tasks with `MefiTasks.selectTask(id)` between captures.

Remove this section once items 1–5 are done or the owner drops them.

## 10. Void Engine Bot: fun, memory, release pings and model drops (parked on `wip/bot-fun-memory`)

Written 2026-09-28 by the session "Discord community perks and verification". It covers the bot repo only
(private `nateecho32-stack/void-engine-bot`); nothing in Studio changes.

### What the owner asked for

- **An @everyone post only when a new version is built**, not for every commit.
- **Updates in the server about new model drops.**
- **A fun bot that remembers things.**

### Where it is

- **Branch:** `wip/bot-fun-memory` on the bot's origin (`61e8e8d`, one commit on `61b1deb`). The bot's main checkout, `C:\Users\echor\OneDrive\Desktop\Coding Projects\Void Engine Bot`, is on that branch. The bot's `main` is still `61b1deb`.
- **Tests:** `npm test` gives 618 tests: 610 pass and 8 fail. All 8 are at integration seams; the commit message names them.

### What is built

- **Release pings** (`src/releases.mjs`):
  - It announces only a published release whose tag matches `RELEASES_TAG_PATTERN` (`^v\d+\.\d+\.\d+$`) and that has a built `.zip` (`RELEASES_REQUIRE_ASSET`). A release still waiting for its zip is picked up on a later hourly poll. Commits, and tags with no release, are never announced.
  - `RELEASES_PING=everyone` is the default (also `here`, `role:<id>` or `none`). Pre-releases post quietly (`RELEASES_PRERELEASES=quiet|skip`).
  - The post has a heading, a persona line, up to 5 cleaned highlights, the zip link and size, and the release link.
  - Without Mention Everyone in the channel, it posts without the ping and logs a warning. A test guards that only `releases.mjs` asks for `parse: ['everyone']`.
- **Model drops** (`src/models-watch.mjs`):
  - It reads models.dev every 6 h for anthropic, openai, google, zai, deepseek, xai, moonshotai, alibaba, mistral and opencode-go (`MODEL_DROPS_PROVIDERS`).
  - A drop is an unseen id released in the last 30 days, deduped by `canonical_model_id`. The first run is a silent baseline.
  - It posts one digest per poll in `MODEL_DROPS_CHANNEL_ID` (5 models, then "+N more"), marked "✓ in Studio", plus "✨ New in Studio" from mefi-studio `data/models.json`. It reads both `models[]` and `providerModels`; the first sighting of `providerModels` is a silent baseline.
  - `MODEL_DROPS_ROLE_ID` adds an opt-in role ping, which `/notify models` toggles. `/models latest [provider]` shows recent drops.
- **Chat, persona and memory:**
  - @mention the bot, or reply to it, to chat with "Void". The voice is in `config/persona.md`; the name is `BOT_NAME`.
  - Each member gets 20 chats a day (`CHAT_USER_DAILY_LIMIT`), and chat uses at most 80% of the LLM daily and monthly caps. Every model reply ends with `-# 🤖 AI reply`.
  - It never answers inside room threads and stores no transcripts: an 8-turn ring in memory, kept 30 minutes.
  - Memory needs consent. `/remember`, or "Void, remember …" plus a confirm button. `/memory auto on` (off by default) saves one note per chat, with an Undo button. `/memories` lists and deletes notes; moderators curate `/lore`.
  - Automatic notes expire after 90 days unused and explicit ones after 365. A member who leaves loses their notes, and `/forget-me` wipes everything.
  - `CHAT_DMS` gates DM chat. No DMs arrive until `wip/remote-dms` adds the intent.
- **Fun:**
  - `/help`, built from the command list.
  - Welcomes when a member completes onboarding (`WELCOME_CHANNEL_ID`): once per member, at most 10 a minute.
  - Celebrations for earned roles, streak milestones and join anniversaries (`CELEBRATE_CHANNEL_ID`); `/celebrate off` opts out.
  - `/trivia` about AI models: +2 points, capped at 10 a day.
  - A prompt of the day from `config/prompts.json` (`LOUNGE_CHANNEL_ID`, `FUN_HOUR_UTC`).
- **Integration already done:**
  - `index.mjs` wiring for all of the above, plus the DM seam `hub.onDirectMessage` and `hub.dmRouters` for remote-dms.
  - The config keys and `.env.example`.
  - A v3 store migration (the memory, fun and model tables).
  - Commands and buttons (`mem`, `memsave`, `trv`).
  - Adapter `addReaction`, `replyTo` and `listMembers`, and Add Reactions in `BOT_PERMISSIONS`.

### What is left, in order

1. **Fix the 8 failing tests.** They are seam tests, not feature bugs:
   - the `/help` command list;
   - the v1→v2 upgrade test, which now meets v3;
   - the scheduled job names and counts;
   - the `ensureMemoryTables`-versus-migration check;
   - `main()`'s boot wiring;
   - the new command definitions;
   - the fun jobs with a member list.
2. **Finish the integration.**
   - Extend `test/e2e-hub.test.mjs` through `createHub` with the fakes:
     - an @mention reply with the AI label and no ping;
     - remember → confirm → `/memories` → `/forget-me`;
     - a leaving member's notes are deleted;
     - a v-tag release with a zip → one post with `{ parse: ['everyone'] }`, and no ping without the permission;
     - no zip → no post, then a post once the zip appears;
     - a commit or a non-version tag → nothing;
     - a model-drop digest from a fake models.dev;
     - a welcome, `/trivia` and the prompt job;
     - `/help` listing every command;
     - a DM with no routers reaches the persona, and a router answering `handled: true` means zero LLM calls.
   - Update the job counts in `test/hub-wiring.test.mjs`.
   - Run `npm run register -- --dry-run`.
   - Add the feature list to the README.
3. **Gates:** `node --check` on every file, and `npm test` all green.
4. **Security and policy review** of the new surface:
   - only releases may ping @everyone;
   - prompt injection through memories and lore;
   - memory screening;
   - the DM seam;
   - deletion when a member leaves;
   - nothing from a room thread reaches the LLM.
5. **Land.** Rebase onto the bot's `origin/main`, push the branch to `main` fast-forward only, then delete `wip/bot-fun-memory`.
6. **Tell the three sessions waiting on this push**, with the hash. They land in this order:
   1. **"Co-work and PC linking setup":** rebase `wip/remote-dms` onto it and drop its stand-in `onDirectMessage` and `dmRouters`. Register `createRemoteDmRouter` with `hub.dmRouters.unshift(...)`.
   2. **"Discord bot model feedback integration":** rebase `wip/model-reviews` (section 5). It builds on `createModelsWatch`, whose rows are camelCase: `{ provider, providerName, id, name, family, releaseDate, releasedAt, lastUpdated, cost: { input, output }, limit: { context, output }, reasoning, toolCall, vision, openWeights, canonical, description, firstSeenAt, announced, inStudio }`. It also feeds ratings into chat's `facts`.
   3. **"Build 4.5 roadmap and web upgrades":** FH0/FH1 on the hub. FH10 (bot chat in Studio) reuses `createChatService`, and Studio chat must stay a direct conversation with the bot: keyed by the hub session's Discord id, and never fed room messages.

### The owner's setup to go live

- **The bot application.** Paste its token into the bot's `.env` yourself. Turn on the Server Members intent; Message Content is needed only for rooms and model reviews.
- **Add Reactions.** Grant the bot's role this new permission, or re-invite with `npm run invite`.
- **Channels, with their ids in `.env`:**
  - #releases, with a channel override granting the bot **Mention @everyone**. Without it, releases post but don't ping.
  - #model-drops, #welcome, #celebrations and #lounge.
  - The existing #mod-queue, #showcase forum and #rooms.
- **An optional "Model drops" role**, placed below the bot's role, for `/notify`.
- **A pay-as-you-go z.ai key** for the LLM, not the Coding Plan key. The free fallback model stays off until z.ai's terms are checked.
- **Start it.** Run `npm run register`, then set it to start at login with Task Scheduler (`docs/runbook.md`).
- **For rooms, listen together and the remote:** the hub's public address and the "Mefi Studio Link" app id are also needed (sections 1 and 2).

Remove this section once the branch lands on the bot's `main` and the three sessions have rebased.
