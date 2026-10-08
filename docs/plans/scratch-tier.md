# Scratch: storage as low-quality RAM for agents, built while the Studio keeps running

Approved by the owner on 7 October 2026. This is a hand-out: each work package
(WP) below is written for one sub-agent and says what it owns, what it must not
touch, the tests it adds and how it proves itself. The integrator hands them
out and lands them in the order given at the end. Read `AGENTS.md`,
`CONTRIBUTING.md`, `.claude/skills/commit-check/SKILL.md` and
`docs/rust-migration.md` first. Every WP works in its own worktree off
`origin/main` (never a branch in the shared checkout) and lands with
`--ff-only`, then `npm run sync`.

## Why

The owner's laptop (Ryzen AI 7 350, 8 cores and 16 threads, a Radeon 860M
integrated GPU that shares the 16 GB, a WD SN5000S NVMe drive) usually has
about 1 GB free, and lag is paging, not CPU
(`docs/plans/engine-plan-2026-10.md`). Each builder is a CLI subprocess of 0.2
to 0.7 GB, and the engine holds the board in V8 heap: the live board measured
7.9 MB, 91% of it `contextHistory` snapshot bodies, parsed, cloned, hashed and
re-uploaded to OneDrive at every checkpoint (`docs/performance.md`, the board
section).

The ask: use the SSD as a slower tier of memory that agents and the engine lean
on, built in the Rust half (`crates/mefi-core`), working with the CPU, GPU
acceleration where it pays, a tree index for speed; hand the work to
sub-agents; and be able to update the Studio while this is being built without
breaking agent runs.

**Physics, stated once.** A blob in a memory-mapped file is a clean,
file-backed page: Windows drops it under pressure with no pagefile write and
re-reads it from NVMe (about 100 µs) on the next touch. A parsed JavaScript
object is dirty anonymous memory that can only leave through the pagefile. So
"storage as low-quality RAM" means: bytes live in an arena file, the OS page
cache is the only RAM they occupy, and nothing is parsed until asked for. The
integrated GPU carves from the same 16 GB: GPU is compute offload, not memory
relief, and a wgpu context costs 50 to 150 MB in the engine, so it is measured
before it is adopted.

**Owner decisions (2026-10-07):** tracks A, B and C now; D (local embeddings
plus a GPU bench) and E (a quadtree for the Command canvas and brain maps)
later. History bodies flip on automatically once every paired PC runs a build
that reads the new format. Every builder with the desk MCP gets the tools.

**On recovery after an outage.** No product or paper called "Leap" describes
outage recovery; the October 2026 arXiv paper LEAP (2610.02670) is about a
small drafter model that speeds agents up. What the durable-execution
literature agrees on, and what WP0 applies: checkpoint after every completed
step; keep the authoritative run state outside the model provider; on a crash
restart only the agent process and keep the workspace; resume the same session
when the CLI supports it, else start a new one with a recovery prompt that
reconstructs from the workspace; guard side effects with an idempotency ledger
so a resumed run never repeats a commit, push or message. Sources:
[Durable execution for agent runtimes](https://zylos.ai/research/2026-04-24-durable-execution-agent-runtimes/),
[Checkpoint-and-resume pattern](https://www.agentnative.dev/patterns/checkpoint-and-resume-pattern-for-long-running-agents),
[Resuming an agent after a deploy killed it](https://dev.to/gabrielanhaia/resuming-an-ai-agent-after-a-deploy-killed-it-mid-task-3kdp),
[Safe to Resume? (rollback caveats)](https://arxiv.org/pdf/2608.29381),
[LEAP: Learning Efficient Action Proposals](https://arxiv.org/abs/2610.02670).

## What already exists (reuse, do not rebuild)

| Piece | Where | What it gives |
| --- | --- | --- |
| Live updater | `scripts/updater.mjs`, `main.cjs` "live update" block | `style` and `modules` kinds hot-swap `scripts/*.cjs` and the renderer in place; `reload` and `restart` wait behind the pause gate and defer while `autopilot.jobs.length` ("build job(s) finishing before update; new dispatches wait", `executorUpdateHold`) |
| Resume checkpoint | `scripts/executor-resume.cjs` `checkpoint()` | per run: `pid`, `workerPid`, `sessionId`, `cliSession {cli, id, model, account, cwd}`, todos, outputTail, progress; `held()` tells a live worker by pid; `brief()` goes into the next attempt's prompt |
| Boot pass | `main.cjs`, the reconcile pass that builds `liveRuns` | rows whose worker is still alive join `liveRuns` so the sweep does not requeue them, but nothing re-attaches to them |
| CLI stream | `scripts/cli-stream.cjs` | decodes Claude `stream-json` and `codex --json` into text, session id, todos and usage |
| Session ids | `scripts/executor-core.cjs` `cliInvocation` | Claude runs start under a host-chosen `--session-id`; `claude -p --resume <id>` and `codex exec resume <id>` exist (checked 2026-10-07; OpenCode: verify `opencode run --help`) |
| Desk MCP | `scripts/desk-mcp.mjs`, `scripts/desk-server.cjs`, `scripts/agent-brain-host.cjs` `prepareDeskTool` | builders get an MCP server by `--mcp-config`; the loopback port is OS-picked (`listen(0)`), one token per server |
| Isolated Studio | the probe and dogfood launchers (Claude's memory notes `fresh-profile-probe-recipe`, `dogfood-live-test-2026-09-29`; recipe repeated in WP0-A) | a launcher with its own userData, `MEFI_STUDIO_LOCAL_DIR`, `MEFI_STUDIO_REPO`, `MEFI_STUDIO_NO_LIVE_UPDATE=1`, driven over CDP |
| Local dirs | `scripts/local-dirs.cjs` | `%LOCALAPPDATA%\MefiStudio\{journal,logs,archive,migrations,...}`, refuses OneDrive paths |
| Append-only segments | `scripts/segment-archive.cjs` | sealed JSONL segments plus a gzip archive; never deletes a member |

## WP0: build this without breaking agent flows

Three parts. WP0-A is the harness (no product change). WP0-B and WP0-C are
product changes that make an engine restart safe for running agents; they are
useful on their own and land first so every later WP can be tested live.

### WP0-A: two Studios side by side (harness only, nothing committed)

- **Production Studio** keeps running the owner's agents from the shipping
  build. Nothing here touches it.
- **Dev Studio**: an Electron launcher outside OneDrive and outside the repo
  (`C:\wt\probe\launcher` exists on the owner's laptop; its `package.json`
  names mefi-studio and `probe-main.cjs` is the entry). The entry does
  `app.setPath` for userData, sessionData and crashDumps under `PROBE_HOME`,
  points HOME, USERPROFILE, APPDATA, LOCALAPPDATA and
  **`MEFI_STUDIO_LOCAL_DIR`** into it (so its journal, archive and the new
  scratch arena are its own, and the arena lock never collides with
  production), adds `remote-debugging-port` 9339 and
  `disable-features=CalculateNativeWinOcclusion`, parks the window at
  x = -6000 with skip-taskbar, then requires the target checkout's
  `main.cjs` from `PROBE_TARGET` (the WP's worktree, for example
  `C:\wt\scratch-<wp>`). Start it from PowerShell with
  `MEFI_STUDIO_NO_LIVE_UPDATE=1` and `ELECTRON_RUN_AS_NODE` cleared.
- Unlike the fresh-profile probe, the child-process guard allows `claude`
  only, and the settings seed pins the builder to Claude Haiku 5.5
  (`settings.agentKinds`, the quick tier of `scripts/provider-setups.cjs`) with
  `autopilot.parallel: 1`, so live tests spend little.
- **Target project** for the dev Studio: a local clone with its push URL set
  to `DISABLED-no-push` and a pre-push hook that exits 1, never this
  repository.
- Renderer-only changes reach the dev Studio by `npm run build-booklet` plus
  `location.reload()`; `scripts/*.cjs` changes by a restart (or the live
  updater's `modules` kind once WP0-B makes restarts safe); `main.cjs` or Rust
  changes by a restart.

### WP0-B: runs outlive the engine (adopt on boot)

Goal: an engine relaunch (live update, crash, owner restart) no longer kills
or orphans builders. The updater's "defer while jobs run" becomes "restart now
when every running job is adoptable".

Files owned: `scripts/executor-core.cjs` (`cliInvocation` stdio),
`scripts/executor-resume.cjs`, `scripts/run-journal.cjs` (new, pure),
`scripts/run-journal-host.cjs` (new), `scripts/desk-server.cjs`, `main.cjs`
blocks `// ---- Run journal ----` (new) and the boot pass that builds
`liveRuns`, `scripts/local-dirs.cjs` (`LAYOUT.runs`).

1. **Journal instead of pipes.** A builder's stdout and stderr go to
   `%LOCALAPPDATA%\MefiStudio\journal\<projectId>\runs\<runId>.out` (stdio
   `["pipe", fd, fd]`: stdin still carries the prompt; the child survives the
   parent because nothing it writes hits a closed pipe). The engine tails the
   file (`fs.watch` plus an offset poll) through the same `take` callback
   `cliStreamWire` uses today, so `cli-stream.cjs` and every consumer see
   unchanged lines. `resumeCheckpoint` gains `journal: {path, offset}` and is
   written after every event batch (the checkpoint after each completed step).
2. **Adopt on boot.** In the boot pass, a row whose `runProgress.workerPid` is
   alive and whose checkpoint names a journal becomes a re-attached job:
   `autopilot.jobs` gets an entry with `child: null`, `pid`, the tail resumed
   from `journal.offset`, and a pid watcher (`executorProcessAlive` every
   2 s) that fires the ordinary settle path (`settleAttemptRow`) on exit with
   the journal's tail as `lastWords`. The journal's last `MEFI_RESULT` block is
   the result, as today. Kill switch `MEFI_STUDIO_NO_RUN_ADOPT=1` keeps
   today's behaviour (leave it leased).
3. **Desk server survives.** `desk-server.cjs` `start({ port, token })`: the
   port and token persist in `journal/<projectId>/desk.json`; a relaunch
   rebinds the same port (OS-picked only when the saved one is taken, in which
   case runs started under the old one keep working until they end, and their
   config files are not rewritten). `prepareDeskTool` re-registers `owners`
   for adopted runs.
4. **Side effects once.** Settle for an adopted run checks the attempt's
   `acceptedAttempts`, snapshot refs and `executor-log.jsonl` before
   recording, so a settle that already ran in the old engine (a crash between
   settle and exit) is not repeated. Pure rule in `run-journal.cjs`
   `alreadySettled(row, runId)`.
5. **Updater policy.** `executorUpdateHold` and the restart gate: a restart
   proceeds when every job is adoptable (journal present, pid alive, not
   `settlementPending`); otherwise it defers as today. A job mid-settle is
   never interrupted.

Tests: `tests/run_journal.test.mjs` (pure: offsets, `alreadySettled`, tail
parsing of a torn last line), `tests/run_adopt.test.mjs` (vm-sliced boot pass:
an alive pid with a journal becomes a job; a dead pid settles with the
journal tail; the kill switch), `tests/desk_server_port.test.mjs` (rebind the
same port and token; fallback when taken), and the stdio shape in the
executor-core suite. Live proof in the dev Studio: start a Haiku build that
sleeps 3 minutes in its first step, restart the dev Studio through its own
live updater, watch the card finish and settle normally.

### WP0-C: finish it off when the process did die

Goal: an outage (provider outage, PC sleep, a killed CLI) ends with the run
finished, not restarted from zero.

Files owned: `scripts/executor-core.cjs` (`cliInvocation` resume arguments,
`workerPrompt` recovery section), `scripts/executor-resume.cjs`
(`resumable(checkpoint, route)`), `scripts/cli-stream.cjs` (session id from a
resumed stream), `main.cjs` `spawnNextJob` where `sessionId` is chosen.

1. **Same session first.** When the previous attempt's `cliSession` matches
   the route (`cli`, `model`, `account`, `cwd`), the next attempt resumes it:
   Claude `claude -p --resume <id>` (no new `--session-id`), Codex
   `codex exec resume <id>` (`thread/resume` on the app-server harness),
   OpenCode (verify the flag; else fall through). The prompt is the recovery
   prompt, short and budgeted (`RECOVERY_MAX` 1200 characters): "your
   previous run was interrupted at <todos done / in progress>; the workspace
   is as you left it; verify before redoing; do not repeat commits already in
   `git log`; finish and report MEFI_RESULT". Today's `brief()` stays as the
   fallback when the session cannot be resumed (`resumable()` false) or the
   resume exits before speaking (`run.spoke` false: one ordinary attempt,
   counted once).
2. **Outage classes.** `assistantModule.isProviderOutage` already names
   provider outages; the run is parked with `nextRunAt` backoff (existing) and
   resumed by step 1 when the route is back. PC sleep or a crash: WP0-B
   adopts; if the pid is gone, step 1 applies.
3. **Attempt accounting.** A resumed attempt is `kind: "resumed"` in
   `executor-log.jsonl` and in the card log ("resumed session … after
   <reason>"); `runFailures` is not incremented by an outage. Kill switch
   `MEFI_STUDIO_NO_SESSION_RESUME=1` and `settings.executor.resumeSessions`
   (default true).

Tests: `tests/executor_resume_session.test.mjs` (`resumable` route matching;
recovery prompt budget; fallback paths; the kill switch), the `--resume` and
`exec resume` argument shapes as pinned literals in the cli-invocation suite,
a resumed stream's session id in the cli-stream suite. Live proof: kill the
Haiku CLI mid-run in the dev Studio (`taskkill` its pid), watch the next
attempt resume the session and finish with one MEFI_RESULT.

## The Scratch tier (tracks A, B, C)

Plain word: **Scratch**. Tiers: hot is the JavaScript heap (what the engine
holds today: the row cache in `scripts/eyes.mjs`, the running task); warm is
`arena.bin` pages in the OS page cache; cold is segment-archive gzip members
(history bodies under `data/`, synced; run scratch under the local
`archive/scratch/`). Location: `%LOCALAPPDATA%\MefiStudio\scratch\<projectId>\`
via `local-dirs.cjs` (`scratch` in `LAYOUT`; the OneDrive refusal is
inherited; the dev Studio's `MEFI_STUDIO_LOCAL_DIR` gives it its own).

Settings and switches shared by the WPs below, defined in WP2:
`settings.scratch = { enabled: true, capMB: 512, historyBodies: "auto" | true |
false, agentTools: true, embeddings: "off", gpu: "off" }`, read through
`scratchRules.prefs(settings, env)`; env `MEFI_STUDIO_NO_SCRATCH=1` (all off,
history inline), `MEFI_STUDIO_RUST_OFF=scratch` (the JavaScript host),
`MEFI_SCRATCH_DIR` (must pass `insideOneDrive`).

### WP1: the arena in Rust (`crates/mefi-core/src/scratch/`)

Files owned: `crates/mefi-core/src/scratch/{mod,arena,buddy,index,journal,bm25}.rs`,
`crates/mefi-core/src/lib.rs` (one dispatch line), `crates/mefi-core/Cargo.toml`
(`memmap2`), `docs/rust-migration.md` (a parity-table row). Must not touch
JavaScript except `tests/rust_parity_scratch.test.mjs`. Build with
`CARGO_TARGET_DIR=C:\rt\<name>` in a worktree (the shared
`%LOCALAPPDATA%\MefiStudio\rust-target` belongs to the Rust migration work).

On disk per project:

```
arena.bin     mmap'd blob store, sparse; set_len grows 16 MiB, then doubles, up to capMB
index.log     append-only {seq, op, key, hash, off, len, kind, at, meta, crc32}
index.snap    periodic checkpoint of the live index (JSON, temp file plus rename)
postings.bin  BM25 postings for searchable kinds (rebuildable; absent means rebuild at open)
scratch.lock  pid lock, the same take-over rule as segment-archive.cjs
```

- Header (page 0, 4 KiB): magic `MFSC`, version 1, page size 4096,
  order_max, used_pages, generation, cap_bytes, clean_shutdown, sha256 of the
  header. A bad header means rebuild from `index.log` plus the blobs.
- **Buddy allocator**: a complete binary tree over 4 KiB pages; node k covers
  2^order pages, its children are the two halves. This is the one-dimensional
  sibling of a quadtree (halves per level instead of quadrants), with the same
  descend-to-smallest-fit allocation and merge-with-sibling on free. Stored as
  a `Vec<u8>` of per-node largest-free-order, 2N-1 entries (a 512 MB cap is
  131,072 leaves, 256 KB of tree). O(log n) allocate and free.
- Index: `IndexMap<String, Entry{hash, off, len, kind, at, meta, ttl}>` plus
  `HashMap<[u8;32], Blob{off, len, refs}>`. Content-addressed with `sha2`
  (already a dependency): a `put` of known bytes adds a key, not a copy
  (`dedup: true`). `at` bumps on `get` in memory (LRU), flushed with the
  snapshot.
- Crash safety: `put` writes the block, appends the log record with a crc32
  (a hand-rolled table, no new crate), then `flush_range` of that block only.
  Open: load the snapshot, replay the log past its sequence number, drop any
  record whose blob sha mismatches (a torn write), rebuild the buddy tree from
  the live blobs.
- Cap and eviction: over the cap, evict evictable kinds LRU-first (run scratch
  past its TTL, then any run scratch), never `history`; still full answers
  `{ok: false, reason: "full"}`. Compaction when dead bytes exceed 25% of used
  and 32 MiB, or on `compact`: copy live blobs into `arena.bin.next`, a fresh
  snapshot, rename, `generation += 1`. Never on the reply thread
  (`src-tauri/src/engine.rs` already runs `core.*` calls under
  `spawn_blocking`).
- BM25: lowercase, split on non-alphanumerics, tokens longer than 2
  characters, no stemming; k1 1.2, b 0.75; tie-break score descending, then
  `at` descending, then key ascending; postings bounded to 32 MB of heap
  (oldest documents leave the index, not the arena).
- No rayon and no GPU in this WP. Dispatch: `lib.rs` adds
  `Some(("scratch", name)) => scratch::call(name, args, callbacks)`. The first
  argument is the collaborators object like every factory: `{ dir, capMB, now? }`.
  Functions: `open`; `put {key, kind, text, meta?, ttlMs?, searchable?}` answers
  `{ok, hash, bytes, dedup}`; `get {key} | {hash}` answers `{ok, text, kind,
  at, meta}` or `{ok: false, reason: "missing"}`; `has`; `list {prefix?,
  kind?, limit}`; `search {query, kind?, prefix?, limit}` answers `[{key, hash,
  score, snippet, at}]`; `stats` answers `{bytes, capBytes, liveBytes,
  deadBytes, keys, blobs, hits, misses, generation, lastCompactAt}`; `compact`;
  `evict {prefix}`. `mefi-core repo-batch` already routes `<module>.<fn>`, so
  the parity test needs no new subcommand.

Tests: `tests/rust_parity_scratch.test.mjs` against WP2's JavaScript twin
(skips without the binary, like the other parity tests): put, get, has, list,
search, stats, compact, dedup, the cap, missing, malformed, and crash replay by
truncating `index.log`. Proof: `mefi-core repo-batch` with a 100 MB put storm,
then `stats` and `compact`.

### WP2: the JavaScript twin, settings and the Resources line

Files owned: `scripts/scratch-rules.cjs` (new, pure; header "Pure module: no
Electron, no filesystem, no network, no clock reads."; added to the PROMISES
list of `tests/module_purity.test.mjs`), `scripts/scratch-host.cjs` (new),
`scripts/rust-modules.cjs` (FACTORIES `"scratch"`), `scripts/local-dirs.cjs`
(`scratch`), `main.cjs` block `// ---- Scratch tier ----` (`scratchFor(projectId)`,
lazy per project, loaded on first use and never at launch; channels
`scratch:stats` and `scratch:compact` as invokes, `scratch:state` as a push;
per project, not app-wide), `preload.cjs`, the Resources page line (the
resource page's existing pattern and `tests/resources_ui.test.mjs`), Settings ›
Storage controls, `docs/code-map.md` rows, the CHANGELOG line.

- `scratch-rules.cjs`: the key grammar (`run/<runId>/<name>`,
  `task/<taskId>/...`, `shared/...`, `history/<hash>`), `KINDS` with
  `{evictable, searchable, ttlMs}`, `QUOTAS`, `FALLBACK_LIMITS`, the same
  tokenizer and BM25 scorer as WP1 (ranks must match), the eviction choice,
  record encode and decode, `prefs(settings, env)`, `historyReady(peers,
  minVersion)` (for WP4; uses `scripts/link-compat.cjs` `compareVersions`),
  and the stats line's wording.
- `scratch-host.cjs` `createScratch({ dir, capMB, fs, now, log })`: the
  plain-file fallback when the binary is absent (Electron is the shipping
  build). Layout `<dir>/blobs/<hh>/<hash>` plus `index.jsonl` (append) and
  `index.json` (checkpoint, temp file plus rename). Bounded so it never becomes
  the board problem again: only index records live in memory (`keys` 20,000,
  `indexBytes` 4 MB, beyond which `put` answers `full`); `get` reads one file;
  `search` builds postings lazily, newest first, up to `searchBytes` 8 MB and
  answers `partial: true` past it; writes are `fs.promises`, never on the
  gateway's synchronous path.
- `rust-modules.cjs`: `call("core.scratch.<fn>", [{dir, capMB}, request])`,
  every method `.catch`-wrapped to the same `{ok: false, reason}` shapes;
  `MEFI_STUDIO_RUST_OFF=scratch` keeps the JavaScript host.
- Resources line: "Scratch: 61 MB of 512 MB, 1,204 keys, 94% hits, compacted
  2 h ago", with a Compact action.

Tests: `tests/scratch_rules.test.mjs` (buddy invariants through a JavaScript
model: allocate, free, merge, the fragmentation bound; BM25 ranking and
tie-break; quotas; prefs; `historyReady` with peers behind, ahead and none),
`tests/scratch_host.test.mjs` (the fallback bounds: key 20,001 refused,
`partial` search, a torn `index.jsonl` line), `tests/scratch_ipc.test.mjs`
(channel sanitising, the kill switch), the module-purity entry, the
local-dirs OneDrive refusal of `MEFI_SCRATCH_DIR`. Proof: the line on Team ›
Resources in the dev Studio under both hosts (`MEFI_STUDIO_RUST_OFF=scratch`
and with the binary).

Coordination: WP1 and WP2 agree the wire shapes above before either starts;
the parity test is the contract. They run in parallel in separate worktrees;
WP2 lands first (the JavaScript fallback is complete on its own), then WP1.

### WP3: agent recall (track C)

Files owned: `scripts/desk-mcp.mjs` (`TOOL` becomes `TOOLS`),
`scripts/desk-server.cjs` (`POST /scratch` with a per-route body limit: put
256 KB, `ask` keeps 16 KB; `handle` becomes `{ ask, scratch }`),
`scripts/agent-brain-host.cjs` (`prepareDeskTool` passes `scratch`, enforces
`QUOTAS`: perPutBytes 256 KB, perRunKeys 200, perRunBytes 8 MB, perTaskBytes
32 MB; kind `run` with a TTL of 7 days, or task done plus 30 days),
`scripts/executor-core.cjs` (one budgeted prompt line: park long outputs with
`scratch_put`, recall with `scratch_get` and `scratch_search`),
`scripts/task-context.cjs` (`buildTaskHandoff(task, {..., recall})` gains the
section "Parked outputs from earlier attempts (read with scratch_get)" at
6% of the cap; dependency rows gain `scratchKeys`), and the `compileMemory`
callers in `main.cjs` and `agent-brain-host.cjs` (they pass `recall` cells with
`cell: "scr"`; `compileMemory` itself stays pure and unchanged).

Tools: `scratch_put {key, text, kind?: "note" | "output" | "result"}` answers
`{key, bytes, hash}`; `scratch_get {key}`; `scratch_search {query, limit?}`
answers keys with snippets; `scratch_list {prefix?}`. Keys are namespaced
server-side as `run/<runId>/<key>`; the search scope is `task/<taskId>/...`
plus that task's runs plus `shared/`. The tools appear only when
`settings.scratch.enabled` and `agentTools` are on; Claude Code and OpenCode
take the desk config as today.

Tests: `tests/desk_mcp_scratch.test.mjs` (tools/list, quotas, namespacing,
the 256 KB refusal), `tests/desk_server_scratch.test.mjs`,
`tests/task_handoff_recall.test.mjs` (the section budget; the brief stays
under `maxChars`), `tests/compile_memory_recall.test.mjs`, and a scope test
(another task's outputs are never returned). Proof: in the dev Studio a Haiku
build parks a 100 KB log with `scratch_put` and ends; the next attempt's
handoff lists the key and `scratch_get` returns it; then kill the CLI mid-run
and confirm WP0-C's resumed attempt still sees its parked keys.

### WP4: contextHistory bodies out of the board (track B)

Files owned: `scripts/task-context.cjs`, `main.cjs` (`mutateBoard` after
`recordTaskRevision`; `eyes:task-history`; the new `eyes:task-revision-body`;
the restore handler; `writeTaskRunContext`; the migration under
`// ---- Scratch tier ----`), `scripts/pc-fleet.cjs` (`cleanPeer` keeps
`lastApp`), `scripts/paired-transport.cjs` (records the negotiated `app`
version on the peer), the renderer's task-history view (a body on demand),
`docs/performance.md` numbers.

- Row shape v2: an entry is `{id, revision, at, kind, note, hash, briefHash,
  runId, snapshotRef: {hash, bytes}}` and `contextHistory.version` is 2.
  `briefHash` (sha256 of `compactHistory`'s brief view) and `runId`
  (`snapshot.lastAttempt?.runId`) are computed as the body leaves the row, so
  compaction never needs a body. The latest entry's `hash` still drives
  `recordTaskRevision`'s no-op fast path. `legacyMatch` applies only to inline
  v1 entries.
- Source of truth for bodies, reaching all three PCs:
  `data/projects/<id>/history/` through `segment-archive.cjs` (`dir` and
  `archiveDir` both under it), kind `history-<pcId>` so two PCs never append
  to one segment and OneDrive never merges a file. Record `{t, hash, taskId,
  revision, body}`. The arena is a cache and index: a miss scans `history-*`
  segments and archives newest first (`readMember`) and re-warms; a fresh PC
  rebuilds its arena from the folder in a bounded background job.
- `historyBodies: "auto"` turns on only when `historyReady(peers, minVersion)`
  says every paired PC's `lastApp` is at or past the first build that reads
  v2 (no peers means ready). The migration writes the board to
  `migrationsDir(date)` and `eyes-tasks.v1.bak` beside it. Reverse path: under
  `MEFI_STUDIO_NO_SCRATCH=1` or `historyBodies: false` the reader hydrates v2
  entries back to inline on the next write, so either direction works.
- `task-context.cjs` (stays pure): `historyEntries` accepts versions 1 and 2;
  `entriesOf` accepts `snapshotRef`; `restoreTaskRevision(task, revisionId,
  { now, snapshot })` takes the hydrated body (the gateway mutator is
  synchronous, so the host awaits `scratch.get` before mutating);
  `compactHistory` reads `briefHash` and `runId` when present; new
  `externalizeHistory(task)` answers `{ task, bodies: [{hash, snapshot}] }`
  and `hydrateHistory(task, bodiesByHash)` reverses it.
- `mutateBoard`: externalize after `recordTaskRevision`, collect the bodies;
  after the write commits, append them to the history archive and
  `scratch.put` (async, try/catch, never fails the board write; a failed
  append keeps that entry inline, and a mixed row is valid for v2 readers).
  The `eyes.mjs` row cache is untouched (it already shares `contextHistory` by
  reference). `buildTaskHandoff`'s footer counts through `historyEntries` and
  says "bodies in Studio's history archive".
- Expected win on the measured board: file 7.9 MB to about 0.8 MB; parse
  about 30 ms to about 3 ms; V8-retained history 25 to 40 MB to about 3 MB;
  OneDrive upload per checkpoint 7.9 MB to 0.8 MB.

Tests: `tests/task_context_v2.test.mjs` (externalize and hydrate round trip;
v2 compaction equals v1 compaction on the same history; restore with a
supplied body; mixed rows), `tests/history_archive.test.mjs` (per-PC kinds,
rebuild from the archive, the cold-miss path), `tests/history_migration.test.mjs`
(the backup is written; the reverse migration; `historyReady`), and the row
cache suite extended. Proof: `docs/performance.md`'s gateway recipe on a copy
of the 7.9 MB board before and after (file size, parse, checkpoint CPU,
event-loop gap), with the numbers in the commit; open the project on a second
PC and restore a revision there.

### Deferred (not this cycle, recorded so the design holds)

- **D: embeddings and the GPU.** Network stays in JavaScript:
  `scratch-host.cjs` calls LM Studio (`127.0.0.1:1234/v1/embeddings`, Vulkan
  on the 860M) or Ollama when `embeddings: "local"` and a server already
  answers (Studio starts neither; neither was running on 2026-10-07). Vectors
  as f16 by hash in `vectors.bin`; `scratch.similar` is chunked f32 dot
  products on a rayon pool (threads `MEFI_RUST_JOBS`, else `max(1, cores/4)`,
  capped at `cores/2`, below-normal priority through `windows-sys`). At this
  app's corpus (thousands of documents, 768 dimensions) brute force takes
  2 to 4 ms on one core; wgpu only pays above roughly one to two million
  vectors or more than 64 batched queries, because upload, dispatch and
  readback through shared RAM cost 1 to 3 ms fixed. Decision rule:
  `mefi-core scratch-bench --vectors N --dims 768 --queries Q` prints cpu-1,
  cpu-rayon and wgpu (a cargo feature `gpu`); adopt wgpu only if it is under
  half of cpu-rayon at the owner's real corpus size, and `gpu: "auto"` then
  means "measured faster at open". The NPU (XDNA 2 through ONNX Runtime) is
  noted here and nothing more.
- **E: quadtree.** `renderer/space-index.js` (`createSpaceIndex({x, y, w, h,
  capacity: 8, maxDepth: 8})` with `insert`, `query`, `nearest`, `clear`;
  rebuilt per frame) for `renderer/idle.js` `buildLabelBlocker` (the 64 px
  grid kept behind a switch), the `occupied` clearance scan, and
  `renderer/brains.js` `overlaps` (auto-layout). Measure with
  `tests/command_performance.test.mjs`'s overlap counter plus a 2,000-node
  synthetic; pin the 48-node capture's labels. Unrelated to the memory tier
  beyond the word it shares with the buddy tree.

## Memory accounting

No change to `scripts/machine.mjs` `workerCapacity` (the 440 MB rule):
Windows reports mapped file pages as available once trimmed, so counting
arena bytes would double-count and starve admission. The real heap is the
BM25 postings (at most 32 MB) and the fallback index (at most 4 MB).
`scratch.residentMB` is for display only.

## Integration order and the protocol for sub-agents

1. **WP0-B, then WP0-C** (one agent, in sequence; they share
   `executor-resume.cjs` and `executor-core.cjs`). Land first: after this,
   every later live test may restart the dev Studio freely.
2. **WP2 and WP1** in parallel (two agents, disjoint files; the parity test
   is their contract). Land WP2, then WP1.
3. **WP3 and WP4** in parallel (two agents; WP3 owns the desk and handoff
   files, WP4 owns task-context and the gateway; the only shared file is
   `main.cjs`, in different marked blocks: WP3 in the desk and `spawnNextJob`
   area, WP4 in `// ---- Scratch tier ----` and `mutateBoard`). Land WP3, then
   WP4 (the riskier format change, which stays behind `historyBodies: "auto"`).
4. Records per WP: a CHANGELOG line, `docs/code-map.md` rows, a TESTRUNS row
   through `node scripts/append-testruns-row.mjs`, `npm run build-booklet`
   when the renderer changed.

Rules every sub-agent follows:

- Own worktree off `origin/main` (`git worktree add C:\wt\scratch-<wp>
  origin/main`, a node_modules junction, unlinked with
  `cmd /c rmdir <wt>\node_modules` before the worktree is removed).
- Touch only the files the WP owns. Every new behaviour has a kill switch and
  a pinning test. No synchronous I/O or eager `require` on startup or on a hot
  path. `main.cjs` hooks are small, `typeof`-guarded, try/catch-wrapped,
  inside marked blocks, and the vm-sliced suites get stubs for new
  collaborators.
- `npm run check`, `npm test` and `npm run audit` green, with the Rust binary
  built (`npm run host:core`) for anything that touches `crates/`.
- On any resume after a gap, read `git log origin/main -20 -- <paths>` and
  `npm run worktrees` before continuing.
- Report back with: what landed (the commit), what the live proof showed,
  what was left out and why.

## Risks

- mmap on a folder OneDrive could see: the `insideOneDrive` refusal covers
  it. A second process on the same arena: `scratch.lock` refuses (the dev
  Studio has its own `MEFI_STUDIO_LOCAL_DIR`).
- Adopting a run whose desk port changed: the run keeps its old config until
  it ends; nothing is rewritten.
- A resumed session repeating a side effect: the recovery prompt names
  `git log`, and settle checks `alreadySettled`.
- Version skew across PCs for v2 boards: `historyBodies: "auto"` with
  `historyReady`, and the reverse migration.
- A chatty flash model spamming puts: the quotas; prompt growth: one budgeted
  line.
- CI never runs Rust parity (`ci.yml` has no Rust step): parity is checked on
  the PC that built the binary, as for every port.
