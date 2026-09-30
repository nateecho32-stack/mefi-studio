# Model community feed: the contract between the Void Engine Bot and Studio

Version 1, 2026-09-28. Both repos keep a copy: Studio in
`docs/model-community.md`, the bot in `docs/model-reviews.md`. A change to the
shape needs both repos' tests and both copies.

## Why it exists

The owner wants model picks to learn from the community without learning from
mood. The feed separates the four kinds of knowledge, and Studio weighs them
differently:

| Tier | Where it comes from | Studio routing weight |
| --- | --- | --- |
| `documented` | The provider's release notes and docs, fetched from an allow-listed URL and summarised per task kind | Shown; a small prior only when the claim is specific (names a benchmark, a limit or a behaviour) |
| `observed` | A member's review that describes what they ran and what happened (a reproduction, a link, a diff, numbers) | A small prior once at least 2 distinct members reported the same claim |
| `opinion` | Reviews without an account of use ("it's bad", "feels smart") | Shown, never used for routing |
| `rating` | `/rate` scores 1-5 per task kind | Shown; used only for task kinds with at least 3 ratings that carry an evidence note, and only as a small prior |

Studio's own measurements always outrank the feed: runner-verified wins and
losses from the model ledger first, then Studio's own probe runs, then the
feed. The feed can move a routing prior by at most +/-0.05 and never overrides
a settled local record.

## Task kinds

A fixed vocabulary, in this order:

`planning`, `structuring`, `coding`, `debugging`, `writing`, `commits`,
`tests`, `setup`, `review`.

- planning: breaking a goal into steps, specs, roadmaps
- structuring: module and file layout, refactors that move code, APIs
- coding: writing new code that works
- debugging: finding and fixing a failure from symptoms
- writing: docs, READMEs, release notes, UI copy
- commits: commit messages, splitting changes, PR descriptions, git handling
- tests: writing tests and test setups, fixing failing tests
- setup: installs, configs, CI, environments, tool wiring
- review: reading someone else's change and finding real problems

Unknown kinds in the feed are dropped by Studio, never guessed.

## Where it lives

- Published by the bot to the `gh-pages` branch of
  `nateecho32-stack/mefi-studio`, path `data/model-community.json`, through the
  GitHub contents API. The bot commits only when the content hash changes, at
  most once every 3 hours, with the message `Update model community feed`.
- Public URL:
  `https://nateecho32-stack.github.io/mefi-studio/data/model-community.json`
- Studio fetches it at most every 6 hours (and on demand from Models), with a
  20 s timeout and a 1 MB cap, keeps the last good copy in its user data
  (`model-community.json`, never under the repo's `data/`), and runs with no
  feed at all when it has never fetched one.

## Shape

```json
{
  "schema": 1,
  "generatedAt": "2026-09-28T18:00:00.000Z",
  "source": { "name": "Void Engine", "kind": "discord-community", "url": "https://discord.gg/xgfKc5pVxG" },
  "taskKinds": ["planning", "structuring", "coding", "debugging", "writing", "commits", "tests", "setup", "review"],
  "models": [
    {
      "key": "anthropic/claude-opus-5-5",
      "provider": "anthropic",
      "id": "claude-opus-5-5",
      "name": "Claude Opus 5.5",
      "releaseDate": "2026-09-22",
      "aliases": [{ "provider": "opencode-go", "id": "claude-opus-5-5" }],
      "forumThread": "https://discord.com/channels/<guild>/<thread>",
      "ratings": {
        "overall": { "n": 12, "mean": 4.3 },
        "byTask": {
          "planning": { "n": 5, "mean": 4.6, "withEvidence": 3 }
        }
      },
      "documented": [
        {
          "taskKind": "planning",
          "claim": "Holds long agentic plans over a 1M-token context.",
          "specific": true,
          "source": { "title": "Claude Opus 5.5 release notes", "url": "https://..." },
          "fetchedAt": "2026-09-28T17:00:00.000Z"
        }
      ],
      "claims": [
        {
          "taskKind": "commits",
          "polarity": "weakness",
          "tier": "observed",
          "text": "Writes commit subjects over 72 characters unless told the limit.",
          "reporters": 3,
          "withEvidence": 2,
          "firstSeen": "2026-09-23",
          "lastSeen": "2026-09-27"
        }
      ],
      "tips": [
        { "taskKind": "tests", "text": "Ask for the failing test first, then the fix.", "votes": 4 }
      ],
      "probeIdeas": [
        { "taskKind": "commits", "idea": "Give a 6-file diff and check the subject stays under 72 characters." }
      ]
    }
  ]
}
```

### Field rules (Studio validates all of them and drops what fails)

- `schema` must be 1. Anything else: ignore the whole feed.
- `models` at most 400 rows. `key` is `provider/id`, both matching
  `/^[a-z0-9][a-z0-9._:-]{0,79}$/i`.
- `aliases` at most 8, same id rule. Studio matches its own rows by `id` first,
  then by alias id, with a provider mapping (`opencode-go` = OpenCode Go
  roster, `anthropic` = Claude, `openai` = Zen/Codex OpenAI models, `zai` or
  `zhipuai` = z.ai). When neither finds a row under the mapped provider, an
  id or alias id that exactly one row carries still matches (the same model
  served by another host, such as a Claude model on OpenCode Go without an
  alias); an id two rows carry matches nothing. Ids compare
  case-insensitively, and Studio's own routing prefixes (`opencode-go/`,
  `mefi-zai/`) come off first. So the bot should still list every hosting
  provider as an alias.
- Text fields are plain text: control characters stripped, `claim` and `text`
  at most 200 characters, `idea` at most 200, names at most 80. Studio renders
  them with `textContent` only and never follows or fetches a feed URL except
  opening `forumThread` and `source.url` in the external browser when they are
  `https:` URLs.
- A text field over its limit drops the entry that holds it (a model's
  `name` falls back to its id); Studio never truncates feed text into place.
  A `documented` entry without an `https:` `source.url` is dropped: an
  unsourced claim is not documented.
- Counts are non-negative integers; `mean` is 1-5 with one decimal (a mean
  with more decimals, a rating with `n` 0 or with `withEvidence` above `n`,
  and a claim with `withEvidence` above `reporters` are dropped).
- `claims` at most 40 per model, `tips` at most 20, `documented` at most 20,
  `probeIdeas` at most 10.
- `tier` is `observed` or `opinion`; `polarity` is `strength` or `weakness`.

## Studio side

- `scripts/model-community.cjs` validates, matches and maps; main.cjs's
  "model community feed and probes" block fetches (with `If-None-Match`),
  keeps `userData/model-community.json` and serves `models:community` and
  `models:community-refresh` (read-only; a Refresh waits at least a minute
  between fetches). Routing reads the saved copy and never waits on the
  network: a stale copy starts one background fetch.
- Studio tasks map to task kinds explicitly (`TASK_KIND_MAP`):
  `coding` and `coding-implement` read `coding`, `coding-document` reads
  `writing`, `coding-analyze` and `cluster-reviewer` read `review`, the
  planning service's `planning-*`, `cluster-planner`, `seat-lead` and
  `pipeline-draft` read `planning`, `setup-assist` reads `setup`, and
  `probe-<kind>` reads its kind. Everything else (chat, `coding-explore`,
  the cadence passes, the judge) reads nothing.
- What routing may see per kind (`evidenceFor`): at most 2 specific
  documented claims, at most 3 observed claims with 2 or more reporters, and
  the kind's rating when 3 or more ratings carry evidence. Opinions, tips and
  probe ideas never reach routing. The prior moves by at most +/-0.05 for all
  of it together (`communityShift` in `scripts/model-routing.mjs`).
- Studio's own probes (`scripts/model-probes.mjs`, userData
  `model-probes.json`) are a separate, stronger tier: small fixed tasks with
  deterministic scorers, run only from Models › Community › Run probes, and
  worth at most +/-0.10 of prior. Runner-verified task outcomes outweigh both.
- `probeIdeas` are shown to no one yet; they are candidates for future
  probes, which Studio adds by hand with a scorer, never from feed text.

## Privacy (bot side)

- No Discord user ids, names, message ids or raw message text in the feed.
- A forum reply is analysed once and only its derived claim (a paraphrase, at
  most 200 characters) is kept, with the author's id held privately for
  counting distinct reporters and for `/forget-me`. The feed publishes a claim
  only when at least 2 distinct members reported it, or 1 member with evidence
  who also used `/rate` on that model.
- Tips come only from `/tip`, whose description says tips are published
  anonymously to Studio's model catalog. `/forget-me` removes a member's
  ratings, claims and tips, and the next publish drops them.
- The forum's guidelines (the bot posts them as the channel's pinned rules)
  say that replies in #model-reviews are read by the bot to build the model
  guide.
