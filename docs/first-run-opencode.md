# First run on OpenCode — design, evidence and wiring plan

Written 2026-09-21 against opencode 1.18.31 and the Studio tree at commit
c791fbd plus the uncommitted work of the same day. Status: **Parts 1–5 are
applied and the booklet is rebuilt** — the scan and apply IPC, the
seven-stop walkthrough with progress and activity bars, the first map, the
free builder route with its one-worker cap, and the stand-in judge in worker
routing and intake — plus the **setup assistant**: the AI linked at the Scan
stop plans the remaining stops and suggests the first task
(`scripts/setup-assist.mjs`, `assist()` in the service, `setup:first-assist`).
**Part 6 (admitting free Zen rows to the catalog router) is deliberately not
applied**: worker routing today only compares the two z.ai models, and the
free builder is a saved choice rather than a routed candidate, so the gate
change would add candidates nothing consumes. Run `npm run package` to
refresh the portable copy.

### How the first launch now runs

1. The guide opens by itself at **Scan** and starts the scan (read-only,
   about ten seconds) with a determinate activity bar over its six steps.
2. **Use this setup and continue** saves the choices, then: with a folder
   already selected it moves to **First map** and maps it (indeterminate
   bar with the explorer's current step and elapsed time, Cancel available);
   without one it waits at **Your workspace** and maps the folder the moment
   one is selected.
3. After a successful map the guide asks the linked AI (the assistant's chat
   model when it is the judge, else the free explorer through `opencode
   run`, else built-in guidance from the facts) to plan the remaining stops.
   The plan shows in the assistant panel on every later stop, the current
   stop highlighted, with **Put the suggested task in the task box**, which
   fills the task box and never sends.
4. The setup progress bar (sheet header and invitation card) follows the
   ticked stops out of seven.

## 1. The ask

Make the first-time walkthrough work with OpenCode out of the box:

1. a **first scan** that finds what this machine can already do — the
   OpenCode CLI, the providers it has linked, the free models it can reach,
   and any provider the owner links later;
2. **choose a folder**, then let an agent **set up the node tree** for that
   folder;
3. use **free agents to explore** projects and **free coding agents to do
   work**, or whatever linked provider the owner prefers;
4. a **decent model that picks what to work on when there is no Jev key**;
5. cover the gaps and edge cases.

## 2. What exists today (verified in the tree)

| Area | State | Evidence |
| --- | --- | --- |
| Walkthrough | Five read-only lessons (Your workspace → Connections → Create → Monitor → Review). It never runs anything; state is `localStorage["mefiStudio.walkthrough.v1"]`; only IPC is `assistant:autopilot` for the Auto build toggle. | `renderer/onboarding.js:10-56`, `:75`, `:282`; opened from `renderer/booklet.js:995` after the boot gate |
| Auto setup | One planner over saved-key booleans + five hardcoded `where.exe` probes (`opencode grok codex claude agy`) + an LM Studio probe. No OpenCode auth or model introspection. | `planAutoSetup` `main.cjs:1507-1559`; handler `main.cjs:10799-10833`; `codingCliStatus` `main.cjs:10539-10553` |
| How builders run | `cmd.exe /d /s /c "opencode run --auto[ --model mefi-zai/…]"`, prompt on stdin, config injected through `OPENCODE_CONFIG_CONTENT` with `snapshot:false`. Never `--agent`, never `--format json`, never a probe of the `opencode` binary itself (it is also the fallback target for every other CLI). | `main.cjs:8658`, `executorOpencodeEnv` `main.cjs:2052-2067`, `opencodeRoute` `main.cjs:2126-2147` |
| Free models | Two catalog rows carry `tags:["free"]` but the router's gate (`onRoster && listed && endpoint.kind === "compat"`) excludes both; no `free`/`cost===0` branch exists anywhere. The plan note "keep using free models" describes nothing implemented. | `scripts/model-routing.mjs:62`, `data/models.json` (`ox-alpha-free`, `union-alpha`) |
| Jev | Hosted TypeSafe classifier over four keyed routes; only three call sites; without a key routing returns fixed defaults and intake idles. `parseAnswers` already validates "a language-model fallback (a non-Jev judge adapted through chat)". | `scripts/decision-client.mjs:59-101`, `main.cjs:1131`, `:1728`; fallback contract `decision-client.mjs:352-356` |
| Node tree | Rail nodes are OpenCode **sessions and their todos** under the project root (plus assistant/agent satellites); the Command view adds board **tasks**. There is no folder→tree generator: a fresh folder shows "no recent sessions" until an OpenCode session exists under it. Project scoping is `containsPath(project.path, session.directory)`. | `renderer/tree3d.js:818-1018`, `renderer/idle.js:922`, `scripts/projects.cjs:139-233`, `scripts/eyes.mjs:210-215` |
| Folder scan | Adding a folder (native dialog only) kicks `analyzeProject`: bounded local inventory (1,200 files, depth 10), plan documents, discovered-not-run checks, starting points. Output lives in an in-memory map capped at 8; nothing reaches the tree. | `main.cjs:10453-10470`, `:10248-10252`, `scripts/analyzer.mjs:264`, `:545` |
| Keys | Two credential worlds: the Studio's DPAPI fields in `%APPDATA%\Mefi's Studio AI+\settings.json` and OpenCode's own `~/.local/share/opencode/auth.json` + env variables. Neither side reads the other. | `main.cjs:74`, `:10619-10625`; `opencode auth list` |

## 3. OpenCode facts measured on 2026-09-21 (1.18.31)

CLI surface: `opencode run [message]` with `--model provider/model`, `--agent`,
`--dir`, `--format json`, `--title`, `--session/--continue`, `--attach`,
`--auto`; `opencode providers` (alias `auth`) `list`; `opencode models
[provider] [--verbose] [--refresh]`; `opencode agent list|create`; `opencode
debug config|paths|agent <name>`; `opencode serve`. Built-in agents on this
machine: `build`, `plan`, `compaction`, `summary`, `title` (primary),
`explore`, `general` (subagents).

Free roster right now (all `cost 0`, tool calls, reasoning): Muse Spark 1.3
Contributor Free (1M context, multimodal), Ling 3.0 Flash Fin Free, Nemotron
3.5 Lightning Free, Muse Spark 1.2 Contributor Free, Nemotron 3 Ultra Free,
MiMo V2.5 Free, Big Pickle. Twenty-plus older free ids are `deprecated` in
models.dev and are skipped. Docs: free models are "available for a limited
time"; "collected data may be used to improve the model"; contributor models
grant "permission to use your prompts and completions to train future Meta
models"; NVIDIA endpoints say "do not submit personal or confidential data".
Paid Zen models keep zero retention.

Probes (scratch folder, one prompt each):

| Probe | Result |
| --- | --- |
| `run --agent plan --model opencode/nemotron-3.5-lightning-free --format json` | ok, 65 s cold / 8–27 s warm; 3 events: `step_start`, `text`, `step_finish` (tokens + cost 0) |
| Same with the prompt on **stdin** | ok (the Studio's stdin convention carries over) |
| `--pure` with the built-in plan agent | ok |
| `OPENCODE_CONFIG_CONTENT={"snapshot":false}` (what every Studio worker injects) | ok |
| `OPENCODE_CONFIG_CONTENT` overriding **only the model** of the built-in `plan` agent | ok |
| A **custom agent** (`mefi-explorer`), with or without a `prompt`, with or without `--pure` | **HTTP 403 "OpenCode's free tier can only be used from within OpenCode"** |
| Built-in `plan` with a **permission override** (`edit/bash/webfetch: deny`) | **same 403** |
| `--auto --model opencode/muse-spark-1.3-contributor-free` build agent, "create hello.txt, print MEFI_JOB_DONE" | ok in 9 s: read → write → `MEFI_JOB_DONE`; file created |
| Plan agent told to run `dir` through bash (an "ask" permission, non-interactive) | no hang: it reasoned in text and never called bash |
| Two free-tier calls on one model at the same time | the second sat at `step_start` for 120 s and was killed; alone it took 8 s |

Command timings for the scan: `--version` 0.7–1.4 s, `auth list` 1.1–1.3 s,
`models` 2.3–3.3 s, `models --verbose opencode` 2.0–2.7 s, `agent list`
1.5–2.2 s. Sequential total on this machine: 9.3–10 s.

Consequences that shape the design:

- **Free explorers and builders must be OpenCode's stock agents** (`plan` to
  read, `build` to write) selected with `--model` or an agent-model override.
  No custom agent names, no permission overrides, no system-prompt overrides
  on a free model — the instructions go in the user message.
- **Free models are only reachable through `opencode run`**, never through
  Zen's HTTP API, so a free judge is a CLI transport with 8–60 s latency:
  fine for batch decisions, useless for per-call model routing (4 s budget).
- **Free work is serialized** (one worker per free model) and needs long
  deadlines and a visible progress line.
- `--format json` gives a clean event stream (`text` parts hold the reply,
  `step_finish` holds tokens/cost, `error` holds the provider message), so
  structured output is parseable without sentinel lines.

## 4. The flow

Lessons become six stops; the first three are new and the last three are
today's Create / Monitor / Review.

### Stop 0 — First scan (new)

"Let me look at what this computer already has." One button, one progress
list (locate → version → linked providers → models → free roster → agents),
9–10 s. Shows, in plain words: OpenCode found (version) or not; providers
linked in OpenCode (names only) and keys saved in Studio; free models
available (count, the recommended one, the data-use notice); what the
explorer, the builder and the judge will be; warnings and next steps. A
**Re-scan** control lives here and in Settings & connections. Nothing is
saved until the owner presses **Use this setup**, which writes
`settings.firstRun = { scanAt, plan: <summary without model lists>,
allowFreeTraining, preferFree }` and applies the same three routing fields
auto setup applies today. The scan never opens `auth.json`, never sends a
prompt, and never changes OpenCode's config.

### Stop 1 — Choose a folder (existing + guard)

Same native dialog. The lesson ticks off on `mefi:project-changed` as today.
The existing local Analyzer scan runs (no AI). New: the lesson refuses to
offer Stop 2 when the scan found no explorer, and says why.

### Stop 2 — First map (new): "set up the node tree"

"I'll have a free agent read the folder and lay out the tree." Runs one
`opencode run --dir <root> --agent plan --model <explorer> --format json
--title "Mefi first map"` with the prompt on stdin and the usual
`snapshot:false` env. The prompt asks the agent to:

1. read the Analyzer inventory the host pastes in (languages, entry points,
   plan documents, checks discovered) and sample the tree with read/glob/grep;
2. **record the map as its todo list** (≤ 12 items: areas, entry points,
   checks to run, risks) — the Studio's eyes reads OpenCode's `todo` table,
   so those todos appear as nodes under the explorer's session node the
   moment they are written; the session is scoped to the project because
   `--dir` sets `session.directory` to the root;
3. finish with one JSON object `{ "areas": [...], "entryPoints": [...],
   "checks": [...], "risks": [...], "firstTasks": [{ "title", "why",
   "check", "files" }] }`.

The host parses the final `text` part, stores `first-map.json` in the
project data dir, and turns `firstTasks` into **ideas** (`source:
"first-map"`) through the existing ideas store — not tasks, so nothing is
admitted, nothing runs, and the growth buffer (`GROWTH_BUFFER = 3`) is not
consumed. Ideas show in Your work and, once the owner promotes one, as task
nodes in Command. Verify-first semantics are untouched. A ten-minute cap, a
visible step line fed from the event stream, Cancel (tree kill), and a
"Map again with a paid model" retry on a free-tier refusal.

### Stop 3 — Connections (existing, reworded)

Same controls, plus the scan summary at the top and a per-role line: explorer
(free/paid), builder (free serialized / paid), judge (Jev / assistant /
free / fixed).

### Stops 4–6 — Create, Monitor, Review (existing)

Unchanged. The Monitor copy gains one sentence: free workers run one at a
time and take longer.

### The judge (Jev stand-in)

`scripts/choice-judge.mjs` answers the same constrained questions Jev does,
through an injected transport, validated by `decision-client.parseAnswers`.
Policy (`pickJudgeRoute`): Jev if any Jev-route key exists; else the
assistant's chat model (`assistantFetch` route: z.ai, OpenCode Go, LM Studio,
custom, or a CLI provider) for routing, intake and triage; else a free
OpenCode model through `opencode run` for intake and triage only; else fixed
defaults. An invalid answer is a failure, never a guess; every attempt
reports `modelCalls: 1` so the improvement budget is charged exactly as for
Jev.

## 5. Landed in this change

- `scripts/first-scan.mjs` — `stripAnsi`, `parseVersion`, `parseAuthList`,
  `parseModelList`, `parseVerboseModels`, `parseAgentList`, `classifyModel`,
  `rankFreeModels`, `planFirstRun`, `runFirstScan`, `spawnExec`,
  `commandLine`. Async spawns only (cmd.exe `/d /s /c` on Windows, exactly
  like the executor), per-step deadline, 2 MB output cap, sequential.
  `node scripts/first-scan.mjs [--raw] [--no-free]` prints the plan.
- `scripts/choice-judge.mjs` — `buildJudgePrompt`, `judgeClassify`,
  `pickJudgeRoute`, `judgeSuits`, `parseRunEvents`, `opencodeRunArgs`,
  `opencodeRunTransport`.
- `tests/first_scan.test.mjs` (real captured CLI output, escape codes
  included) and `tests/choice_judge.test.mjs` (real `--format json` lines,
  the 403 refusal). Run alone: `node --test tests/first_scan.test.mjs
  tests/choice_judge.test.mjs`.
- `package.json` `check` chain covers both modules (`check-targets` demands it
  for every `scripts/*.mjs`).

Sample plan on this machine (OpenCode Go credential; Zen and OpenRouter via
env variables; no Jev key readable outside Electron): explorer = Muse Spark
1.3 Contributor Free on `plan`; builder = OpenCode's default on the Go account
with the free model offered as the alternative; judge = free CLI judge for
intake/triage, routing fixed; two warnings about env-only credentials; one
next step about saving a Jev or assistant key.

## 6. Wiring plan (exact seams, in order)

Each part is independently shippable and testable. Parts 1–5 are applied
(see §5a and §5b); Part 6 is intentionally left, Part 7 (docs) is partly
done by this file.

### 5b. What Parts 4–5 and the setup assistant landed

- **Free builder route** — `opencodeRoute()` in `executorRunEnv` honours
  `settings.executorModels.opencode` when it is a `provider/model` id
  (Settings already saved it; it was never read), passes it as `--model`,
  marks free ids (`-free` suffix, or the first-run scan's free pick) with
  `free: true` and `parallelCap: 1`; `spawnNextJob` returns before claiming
  work when a free route already has a worker running. An id without a
  provider prefix is ignored with a log line, never handed to a shell.
- **Stand-in judge** — `standInJudge(settings, purpose)` in main.cjs builds a
  classifier from `settings.firstRun.judge`: the assistant's chat model
  (`assistantFetch`, taskType `judge`) for worker routing (4 s budget) and
  intake (15 s), or the free explorer through `opencode run` for intake only
  (90 s). `applyModelRouting` uses it only for `worker: true` and only when
  no Jev key exists, so a chat never pays a second call to route itself;
  `runJevIntake` uses it when no Jev key exists and skips the Jev ledger.
  `selectTaskModel` gained a `judge` option that bypasses the key and
  Jev-model gates only for an injected classifier and reports
  `judge-selected`; answers are revalidated exactly like Jev's.
- **Setup assistant** — `scripts/setup-assist.mjs` (`buildSetupAdvicePrompt`,
  `parseSetupAdvice`, `staticSetupAdvice`, `adviceLines`), `assist()` in the
  service (single-flight; assistant chat → free explorer CLI → static), IPC
  `setup:first-assist`, preload `firstAssist`, the walkthrough's assistant
  panel and the auto-run chain (scan on first launch → apply → map → assist).
- Tests: `tests/setup_assist.test.mjs`, new cases in
  `tests/first_run_service.test.mjs`, `tests/model_routing.test.mjs` and
  `tests/onboarding.test.mjs` (progress bar, automatic first scan, the chain
  with and without a folder, failure paths).

### 5a. What Parts 1–3 landed

- `scripts/first-run-service.mjs` — `createFirstRunService(deps)` with
  `status()`, `scan()`, `apply()`, `map()`, `cancel()`. Every host boundary is
  injected; `tests/first_run_service.test.mjs` runs the whole flow (scan →
  apply → map → ideas) against fakes, including the refusal, timeout, start
  failure, unparsable-reply, busy and cancel paths.
- `scripts/first-map.mjs` — `buildFirstMapPrompt`, `extractJsonObjects`,
  `parseFirstMap` (last map-shaped object wins, fenced or narrated; fails
  closed; caps lists), `ideasFrom` (stable ids, project-stamped, `source:
  "first-map"`), `mergeIdeas` (owner's status/taskId win), `firstMapSummary`.
  `tests/first_map.test.mjs`.
- `main.cjs` — one block before `settings:auto-setup`: `firstRun()` builds the
  service from `loadModule`, `readSettings/writeSettings/decryptKey`,
  `resolveAiRoute`, `runAnalyzer`, `executorOpencodeEnv`, the scoped eyes
  facade (ideas + `first-map.json` land in the project's data folder), `send`
  and `logLine`; handlers `setup:first-run-status`, `setup:first-scan`,
  `setup:first-scan-apply`, `setup:first-map`, `setup:first-map-cancel`;
  progress rides `setup:first-map-progress`.
- `preload.cjs` — `firstRunStatus`, `firstScan`, `firstScanApply`, `firstMap`,
  `firstMapCancel`, `onFirstMapProgress`.
- `renderer/onboarding.js` — seven stops (`mefiStudio.walkthrough.v2`, v1
  progress migrated; a finished v1 guide is invited back, never reopened).
  Only the Scan and First map buttons reach the host; reading and navigating
  never do. A missing bridge (browser preview) explains itself. Template
  panels `#walkthrough-scan` / `#walkthrough-map`, styles in styles.css.
  `tests/onboarding.test.mjs` (22 tests).
- `apply()` saves `settings.firstRun`, sets `executorCli` to OpenCode when
  nothing else is chosen, saves the free builder id under
  `executorModels.opencode`, and turns `modelSelection` to `jev` only when a
  Jev key exists. The saved builder model and judge kind are inert until
  Parts 4 and 5 consume them; the apply result says so.

1. **IPC `setup:first-scan` and `setup:first-scan-apply`** — beside
   `settings:auto-setup` (`main.cjs:10799`). The handler runs
   `runFirstScan()` (already async and off the sync path; on the starved host
   run it only from the button, never on a timer), builds `keys` exactly as
   auto setup does (`main.cjs:10801-10809`), adds `prefs.assistantRoute =
   (await resolveAiRoute("routine")).ok`, and returns `planFirstRun(...)`.
   Apply writes `firstRun` and reuses the auto-setup write path
   (`main.cjs:10820-10832`). Preload: two `ipcRenderer.invoke` lines next to
   `autoSetup` (`preload.cjs:22`). `planAutoSetup` (`main.cjs:1507`) gains an
   optional `firstRun` argument so its notes and the scan agree. Keep the new
   functions outside the spans the harness slices (`tests/fixtures/
   host_executor.mjs:141-161`; `planAutoSetup` is sliced from `function
   normalizeAutoProviders(` to `// Pick who pays` by
   `tests/model_auto_setup.test.mjs`).
2. **Walkthrough** — `renderer/onboarding.js` lessons array: insert Scan at
   index 0 and First map at index 2; `KEY` bumps to `v2` with a one-time
   migration of `done[]`; Scan's done-state reads `settings.firstRun` through
   `prefs:get` (not localStorage) so a re-installed renderer cannot claim a
   scan that never happened; First map's `waitFor` is a new
   `mefi:first-map` event. Template: a scan panel and a map panel inside the
   sheet (`renderer/booklet.template.html` near the walkthrough overlay);
   rebuild with `npm run build-booklet`; `npm run audit` checks the contracts.
3. **First map** — new `scripts/first-map.mjs` (pure: `buildFirstMapPrompt
   ({inventory, plans, limits})`, `parseFirstMap(text)` with a strict schema
   and size caps, `ideasFrom(map)`) plus a host `runFirstMap(projectId)` in
   main.cjs that reuses `spawnAttempt`'s spawn shape (`main.cjs:8658`) with
   `--agent plan --format json --dir`, the explorer model from `firstRun`,
   `executorOpencodeEnv()`, `parseRunEvents` for progress, the 10-minute
   kill, and a single-flight guard per project. Results: `first-map.json` in
   the project data dir; ideas through the same path `ideas:save` uses
   (`main.cjs:11188`); `send("eyes:ideas", …)`. The Analyzer's
   `projectScan` (`main.cjs:10180-10210`) is pasted into the prompt so a
   1,200-file bound is never re-walked by the model.
4. **Free builder route** — `opencodeRoute()` (`main.cjs:2126`): when
   `settings.executorModels?.opencode` is a free id (from the scan), return
   `modelArgs: " --model opencode/<free>"`, `free: true`, `via: "opencode
   free"`. Admission: treat `route.free` as `parallel = 1` where the pool
   cap is applied (`EXECUTOR_PARALLEL_CAP` `main.cjs:3132`, enforced
   `:9600`, `spawnNextJob` `:7439`), and stagger free starts. A 403 or 429
   from a free model is a route failure (retry on the alternative), not the
   task's failure — same rule as `fallbackToOpencode` (`main.cjs:8817`).
   `host_executor.mjs:90` stubs `executorRunEnv`, so the fixture gains a
   `free` variant.
5. **Judge** — `applyModelRouting` (`main.cjs:1728`): replace the "Save a Jev
   key" early return with `pickJudgeRoute`; for `assistant` build the
   transport from `httpAssistantCall`/CLI completion with `taskType:
   "judge"`; keep the 30 s backoff and the cache. `selectTaskModel`
   (`scripts/model-routing.mjs:105-107`) must accept a `judge` option that
   bypasses the `apiKey`/`isJevModel` gate when `classifyFn !== classify`
   (the timing race already exists for that case). Intake (`runJevIntake`
   `main.cjs:1131`): on `no-key`, use the free CLI judge with the queue's
   existing 120 s minimum interval and 3-item batches (`jev-loop.mjs:35`).
   Charge through `chargeJevCall` unchanged.
6. **Catalog** — `buildRoutingCandidates` (`scripts/model-routing.mjs:62`)
   admits free Zen rows only when the scan lists them as `usable` and the
   provider is `opencode`; `refresh-models.mjs` adds the Zen `-free` roster
   from models.dev (`cost 0`, non-deprecated) tagged `free`. Until then the
   free ids come from the live scan, which is the safer source (limited-time
   models vanish).
7. **Docs and tests** — GETTING_STARTED "New machine checklist" and
   "Connect one assistant and one builder" gain the scan; README's
   walkthrough paragraph names six stops; feature-audit rows (`docs/archive/feature-audit-2026-09-19.md`) "Requests use
   smaller models" and "Old plans supply unfinished work" change state.

## 7. Gaps and edge cases

| # | Situation | Behaviour | Where |
| --- | --- | --- | --- |
| 1 | OpenCode not on PATH | Scan stops after `where/which`; plan says install; explorer/builder disabled; walkthrough shows Stop 0 as blocked with the install step; Stop 2 is hidden. | `runFirstScan`, `planFirstRun.nextSteps` |
| 2 | Installed for a shell but not for a Start-menu launch (PATH differs) | Same as 1 at runtime; the scan output names the path it found so the owner can see which install answered. | `scan.cli.path` |
| 3 | `--version` fails or hangs (broken shim, security tool, `ELECTRON_RUN_AS_NODE` inherited) | Per-step 20 s deadline, tree kill, `warnings` "did not report a version"; plan unusable until fixed. | `spawnExec`, `planFirstRun` |
| 4 | 0.x CLI | `supported=false`, warning "run `opencode upgrade`", explorer/builder disabled, Jev untouched. | `MINIMUM_OPENCODE_MAJOR` |
| 5 | No providers linked anywhere | Free explorer + free serialized builder + free batch judge; next steps to link a provider or sign in to Zen. | `planFirstRun` |
| 6 | Provider linked only through an env variable | Warning: a GUI launch does not inherit shell-only variables; advise `opencode auth login` or a user-level variable. | `envOnly` |
| 7 | One variable serves Zen and Go (`OPENCODE_API_KEY`) | Both providers listed; Zen alone is never treated as a paid plan. | `paid = linked − opencode` |
| 8 | Keys saved in Studio but not in OpenCode (z.ai `mefi-zai`, Go key) | The plan merges the Studio's key booleans; builders on z.ai keep riding the injected provider; the scan cannot see it and says so. | `keys` argument |
| 9 | Free roster empty or stale | Warning to run `opencode models --refresh`; plan falls back to the paid route or blocks with a reason. | `planFirstRun.warnings` |
| 10 | Free model withdrawn mid-session (403/404) or rate-limited (429) | Route failure: retry once on the next usable free model or the paid alternative; the task keeps its attempt; a message names the model. | Part 4, `parseRunEvents.errors` |
| 11 | Free-tier refusal because the project's own `.opencode/` customizes the `plan`/`build` agent (permission or prompt override) | 403 detected as `freeTierRefused`; the map/judge/builder reports "this project customizes OpenCode agents; use a paid model here or remove the override"; never inject a counter-override. | `FREE_TIER_REFUSAL` |
| 12 | Free-tier data collection is unacceptable to the owner | `allowFreeTraining:false` removes free models from every recommendation; disclosures shown before any free run; contributor models called out by name. | `prefs.allowFreeTraining`, `disclosures` |
| 13 | Two free runs at once (explorer + builder, or two builders) | Free routes carry `parallel: 1`; admission serializes them and staggers starts; the judge queue already enforces a 120 s minimum interval. | `FREE_MODEL_PARALLEL` |
| 14 | Free calls are slow (8–80 s, 120 s+ when queued) | Judge timeouts 90 s (CLI) vs 15 s (assistant) vs 4 s (Jev routing); free judge excluded from routing; first map capped at 10 min with a live step line. | `pickJudgeRoute.timeoutMs` |
| 15 | Folder dialog cancelled / no folder yet | Existing `canceled` path; Stop 2 stays hidden until `mefi:project-changed`. | `main.cjs:10457` |
| 16 | Empty folder or non-git folder | Analyzer inventory is empty; the map prompt says so and asks for a starter scaffold list as ideas; no git required (`--dir` still scopes the session). | Part 3 |
| 17 | Huge monorepo | Analyzer bounds (1,200 files, depth 10) are disclosed in the prompt; the agent samples rather than walks; todo list capped at 12 (tree cap `maxTodos` 14). | `analyzer.mjs:264`, `tree3d.js:829` |
| 18 | OneDrive / cloud-only placeholder files | Read failures surface as the model's own notes; the map records "unreadable" areas; the host never hydrates files. | Part 3 |
| 19 | Paths with spaces, `%`, quotes, newlines | `commandLine` quotes spaces, allows one `%`, refuses quotes/newlines/two `%` with a clear error; the prompt itself rides stdin. | `commandLine` |
| 20 | The Studio's own repo chosen as the project | Existing opt-in rule applies (`explicit`); the map runs like any folder. | `projects.cjs:51` |
| 21 | App quits or project switches during a map | Single-flight guard per project; quit path kills the tree the way executor jobs are killed; a half map is discarded, ideas are written only from a parsed final object. | Part 3 |
| 22 | Agent ignores the todo instruction | The JSON map still seeds ideas; the tree simply shows the session without todos; the lesson explains both outcomes. | Part 3 |
| 23 | Agent returns malformed JSON | `parseFirstMap` fails closed; the sheet offers retry (same model, then paid); nothing is written. | Part 3 |
| 24 | Judge answers with an option that does not exist, adds questions, or writes prose | `parseAnswers` rejects; routing keeps the default; intake leaves the board untouched; the call is still charged. | `judgeClassify` |
| 25 | Assistant route is a CLI provider (Grok / Claude Code / Antigravity) | `assistantFetch` already handles CLI completions, so the assistant judge works; its latency is unknown, so routing uses the 15 s judge deadline and backs off 30 s on failure. | Part 5 |
| 26 | A saved Zen key | Already a Jev route (paid `jev-1.13` pin); next step suggests testing `jev-1.13-free` via `MEFI_JEV_MODEL`. | `planFirstRun.nextSteps` |
| 27 | Re-running the scan later (new provider linked) | Re-scan from Settings; `firstRun.scanAt` updates; walkthrough done-state follows settings, not localStorage. | Part 1–2 |
| 28 | Portable build vs source install | Both read the same CLI; portable data dir is separate (existing rule); the scan record lives in `settings.json` of that install. | AGENTS.md |
| 29 | Non-Windows host | `which` instead of `where`, direct spawn instead of cmd.exe; note that `codingCliStatus` is still Windows-only. | `SCAN_COMMANDS.locate` |
| 30 | Memory-starved host (0.36 GB free measured) | Scan is sequential with deadlines; never scheduled on a timer; the map is one process; free routes never widen the pool. | `runFirstScan` |
| 31 | Test harness traps | New host functions must sit outside sliced spans; `tests/jev_model_routing_host.test.mjs` hangs `node --test` on this machine, so run new specs alone. | memory notes |

## 8. Decisions for the owner

- Default builder when both a paid plan and a free model exist: the plan
  above keeps the paid plan (zero retention, parallel workers) and offers
  free as the alternative; `preferFree` flips it.
- Whether the first map writes ideas only (proposed) or may also create one
  "Run the discovered checks" task under Verify-first.
- Whether the free CLI judge should be allowed for intake at all on a
  metered machine, given each answer holds an OpenCode process for up to 90 s.
