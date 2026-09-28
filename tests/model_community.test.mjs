// The community feed's Studio side (docs/model-community.md): validation drops
// bad rows and keeps the rest, hostile text never survives as markup or
// controls, Studio's models match feed rows by id, alias and provider map, the
// task-kind map is explicit, and only evidence that meets the contract's bar
// reaches routing. fetchFeed runs against stubbed fetches only.
import test from "node:test";
import assert from "node:assert/strict";
import community from "../scripts/model-community.cjs";

const { FEED_URL, LIMITS, TASK_KINDS, TASK_KIND_MAP, validateFeed, matchModel, evidenceFor, taskKindsFor, routingEvidence, fetchFeed } = community;

const row = (extra = {}) => ({
  key: "anthropic/claude-opus-5-5", provider: "anthropic", id: "claude-opus-5-5", name: "Claude Opus 5.5", releaseDate: "2026-09-22",
  aliases: [{ provider: "opencode-go", id: "claude-opus-5-5" }], forumThread: "https://discord.com/channels/1/2",
  ratings: { overall: { n: 12, mean: 4.3 }, byTask: { planning: { n: 5, mean: 4.6, withEvidence: 3 }, commits: { n: 4, mean: 2.1, withEvidence: 2 } } },
  documented: [
    { taskKind: "planning", claim: "Holds long agentic plans over a 1M-token context.", specific: true, source: { title: "Release notes", url: "https://example.com/notes" }, fetchedAt: "2026-09-28T17:00:00.000Z" },
    { taskKind: "planning", claim: "Our best model ever.", specific: false, source: { title: "Blog", url: "https://example.com/blog" } },
  ],
  claims: [
    { taskKind: "commits", polarity: "weakness", tier: "observed", text: "Writes commit subjects over 72 characters unless told the limit.", reporters: 3, withEvidence: 2, firstSeen: "2026-09-23", lastSeen: "2026-09-27" },
    { taskKind: "commits", polarity: "strength", tier: "observed", text: "Splits unrelated changes into separate commits.", reporters: 1, withEvidence: 1 },
    { taskKind: "commits", polarity: "weakness", tier: "opinion", text: "It's bad at git, trust me.", reporters: 9, withEvidence: 0 },
  ],
  tips: [{ taskKind: "tests", text: "Ask for the failing test first, then the fix.", votes: 4 }],
  probeIdeas: [{ taskKind: "commits", idea: "Give a 6-file diff and check the subject stays under 72 characters." }],
  ...extra,
});
const feed = (models, extra = {}) => ({ schema: 1, generatedAt: "2026-09-28T18:00:00.000Z", source: { name: "Void Engine", kind: "discord-community", url: "https://discord.gg/xgfKc5pVxG" }, taskKinds: TASK_KINDS, models, ...extra });

test("a well-formed feed validates whole", () => {
  const result = validateFeed(feed([row()]));
  assert.equal(result.ok, true);
  assert.equal(result.droppedCount, 0, result.dropped.join("; "));
  const [model] = result.feed.models;
  assert.equal(model.key, "anthropic/claude-opus-5-5");
  assert.deepEqual(model.ratings.byTask.planning, { n: 5, mean: 4.6, withEvidence: 3 });
  assert.equal(model.documented.length, 2);
  assert.equal(model.claims.length, 3);
  assert.equal(model.forumThread, "https://discord.com/channels/1/2");
  assert.equal(result.feed.generatedAt, "2026-09-28T18:00:00.000Z");
});

test("a wrong schema ignores the whole feed; bad rows are dropped one by one", () => {
  for (const bad of [null, [], "x", { schema: 2, models: [row()] }, { models: [row()] }]) {
    const result = validateFeed(bad);
    assert.equal(result.ok, false);
    assert.equal(result.feed, null);
  }
  const result = validateFeed(feed([
    row(),
    row({ key: "anthropic/other", id: "claude-opus-5-5" }), // key is not provider/id
    row({ key: "bad provider/x", provider: "bad provider", id: "x" }),
    row({ key: "anthropic/-leading", id: "-leading" }),
    row(), // duplicate key
    "not an object",
    row({ key: "openai/gpt-6-sol", provider: "openai", id: "gpt-6-sol", ratings: { overall: { n: 3, mean: 4.33 }, byTask: { planning: { n: 2, mean: 4, withEvidence: 3 }, vibes: { n: 3, mean: 4 }, coding: { n: 0, mean: 3 } } } }),
  ]));
  assert.equal(result.ok, true);
  assert.deepEqual(result.feed.models.map((model) => model.key), ["anthropic/claude-opus-5-5", "openai/gpt-6-sol"]);
  const gpt = result.feed.models[1];
  assert.equal(gpt.ratings.overall, null, "a mean with two decimals is dropped");
  assert.deepEqual(gpt.ratings.byTask, {}, "withEvidence above n, an unknown kind and n=0 are all dropped");
  assert.ok(result.droppedCount >= 8);
});

test("every per-row limit holds and extra entries are dropped, not truncated into the feed", () => {
  const many = (count, make) => Array.from({ length: count }, (_, index) => make(index));
  const big = row({
    aliases: many(12, (index) => ({ provider: "opencode-go", id: `alias-${index}` })),
    claims: many(55, (index) => ({ taskKind: "coding", polarity: "strength", tier: "observed", text: `Claim ${index}`, reporters: 2 })),
    tips: many(25, (index) => ({ taskKind: "coding", text: `Tip ${index}`, votes: 1 })),
    documented: many(25, (index) => ({ taskKind: "coding", claim: `Doc ${index}`, specific: true, source: { title: "Notes", url: "https://example.com" } })),
    probeIdeas: many(15, (index) => ({ taskKind: "coding", idea: `Idea ${index}` })),
  });
  const models = [big, ...many(LIMITS.models + 20, (index) => ({ key: `vendor/model-${index}`, provider: "vendor", id: `model-${index}` }))];
  const result = validateFeed(feed(models));
  const [model] = result.feed.models;
  assert.equal(model.aliases.length, LIMITS.aliases);
  assert.equal(model.claims.length, LIMITS.claims);
  assert.equal(model.tips.length, LIMITS.tips);
  assert.equal(model.documented.length, LIMITS.documented);
  assert.equal(model.probeIdeas.length, LIMITS.probeIdeas);
  assert.equal(result.feed.models.length, LIMITS.models);
  assert.equal(result.dropped.length, LIMITS.dropped, "the reasons list is capped");
  assert.ok(result.droppedCount > LIMITS.dropped);
});

test("hostile text: controls stripped, over-long text dropped, only https links survive", () => {
  const long = "x".repeat(201);
  const result = validateFeed(feed([row({
    name: `Opus${String.fromCharCode(0x202e)}5.5${String.fromCharCode(7)}`,
    forumThread: "javascript:alert(1)",
    claims: [
      { taskKind: "coding", polarity: "strength", tier: "observed", text: `<img src=x onerror=alert(1)>${String.fromCharCode(0)}ok`, reporters: 2 },
      { taskKind: "coding", polarity: "strength", tier: "observed", text: long, reporters: 5 },
      { taskKind: "coding", polarity: "love", tier: "observed", text: "x", reporters: 2 },
      { taskKind: "coding", polarity: "strength", tier: "rumour", text: "x", reporters: 2 },
      { taskKind: "coding", polarity: "strength", tier: "observed", text: "x", reporters: -1 },
      { taskKind: "coding", polarity: "strength", tier: "observed", text: "x", reporters: 2, withEvidence: 3 },
      { taskKind: "__proto__", polarity: "strength", tier: "observed", text: "x", reporters: 2 },
    ],
    documented: [
      { taskKind: "coding", claim: "Fast.", specific: true, source: { title: "Notes", url: "http://example.com" } },
      { taskKind: "coding", claim: "Fast.", specific: true, source: { title: "Notes", url: "https://user:pass@example.com" } },
      { taskKind: "coding", claim: "Fast.", specific: "yes", source: { title: "Notes", url: "https://example.com/n" } },
    ],
    ratings: { byTask: JSON.parse("{\"__proto__\": {\"n\": 5, \"mean\": 5, \"withEvidence\": 5}, \"constructor\": {\"n\": 5, \"mean\": 5, \"withEvidence\": 5}}") },
  })], { source: { name: "V", url: "file:///etc/passwd" } }));
  const [model] = result.feed.models;
  assert.equal(model.name, "Opus 5.5", "bidi and bell characters are gone");
  assert.equal(model.forumThread, null);
  assert.deepEqual(model.claims.map((claim) => claim.text), ["<img src=x onerror=alert(1)> ok"], "markup stays plain text for textContent; it is never interpreted here");
  assert.equal(model.documented.length, 1);
  assert.equal(model.documented[0].specific, false, "only a literal true is specific");
  assert.deepEqual(Object.keys(model.ratings.byTask), []);
  assert.equal(Object.getPrototypeOf(model.ratings.byTask), Object.prototype);
  assert.equal(result.feed.source.url, null);
});

test("Studio models match feed rows by id, then alias, under the provider map", () => {
  const { feed: clean } = validateFeed(feed([
    row(),
    { key: "zhipuai/glm-5.3", provider: "zhipuai", id: "glm-5.3" },
    { key: "deepseek/deepseek-v4.1-flash", provider: "deepseek", id: "deepseek-v4.1-flash", aliases: [{ provider: "opencode-go", id: "deepseek-v4.1-flash" }] },
    { key: "openai/gpt-6-sol", provider: "openai", id: "gpt-6-sol" },
    { key: "moonshot/kimi-k3", provider: "moonshot", id: "kimi-k3" },
    { key: "a/shared", provider: "a", id: "shared" },
    { key: "b/shared", provider: "b", id: "shared" },
  ]));
  const key = (provider, model) => { const match = matchModel(clean, { provider, model }); return match && [match.row.key, match.matchedBy]; };
  assert.deepEqual(key("claude", "claude-opus-5-5"), ["anthropic/claude-opus-5-5", "id"]);
  assert.deepEqual(key("zai", "glm-5.3"), ["zhipuai/glm-5.3", "id"]);
  assert.deepEqual(key("zai", "mefi-zai/glm-5.3"), ["zhipuai/glm-5.3", "id"], "Studio's routing prefix comes off");
  assert.deepEqual(key("opencode", "deepseek-v4.1-flash"), ["deepseek/deepseek-v4.1-flash", "alias"]);
  assert.deepEqual(key("opencode", "opencode-go/deepseek-v4.1-flash"), ["deepseek/deepseek-v4.1-flash", "alias"]);
  assert.deepEqual(key("opencode", "claude-opus-5-5"), ["anthropic/claude-opus-5-5", "alias"]);
  assert.deepEqual(key("zen", "gpt-6-sol"), ["openai/gpt-6-sol", "id"]);
  assert.deepEqual(key("codex", "GPT-6-SOL"), ["openai/gpt-6-sol", "id"], "ids compare case-insensitively");
  assert.deepEqual(key("opencode", "kimi-k3"), ["moonshot/kimi-k3", "id-any-provider"], "one row anywhere carries the id");
  assert.equal(key("opencode", "shared"), null, "an id two rows carry is ambiguous");
  assert.equal(key("zai", "glm-9"), null);
  assert.equal(key("zai", ""), null);
  assert.equal(matchModel(null, { provider: "zai", model: "glm-5.3" }), null);
});

test("the task-kind map is explicit and unmapped work gets nothing", () => {
  assert.deepEqual(taskKindsFor({ taskType: "coding-implement", role: "worker", weight: "deep" }), ["coding"]);
  assert.deepEqual(taskKindsFor({ taskType: "coding-document" }), ["writing"]);
  assert.deepEqual(taskKindsFor({ taskType: "coding-analyze" }), ["review"]);
  assert.deepEqual(taskKindsFor({ taskType: "coding" }), ["coding"]);
  assert.deepEqual(taskKindsFor({ taskType: "coding", intent: "document" }), ["writing"]);
  assert.deepEqual(taskKindsFor({ taskType: "coding", intent: "made-up" }), ["coding"]);
  for (const kind of ["interview", "questions", "question", "spec", "explore"]) assert.deepEqual(taskKindsFor({ taskType: `planning-${kind}` }), ["planning"]);
  assert.deepEqual(taskKindsFor({ taskType: "cluster-planner" }), ["planning"]);
  assert.deepEqual(taskKindsFor({ taskType: "cluster-reviewer" }), ["review"]);
  assert.deepEqual(taskKindsFor({ taskType: "seat-lead" }), ["planning"]);
  assert.deepEqual(taskKindsFor({ taskType: "pipeline-draft" }), ["planning"]);
  assert.deepEqual(taskKindsFor({ taskType: "setup-assist" }), ["setup"]);
  assert.deepEqual(taskKindsFor({ taskType: "probe-commits" }), ["commits"]);
  for (const taskType of ["coding-explore", "conversation", "judge", "relevance", "ideas", "overseer", "analyzer", "routine", "heavy", "brief", "seat-desk", "speed-probe", "probe-vibes", "", null, undefined]) {
    assert.deepEqual(taskKindsFor({ taskType }), [], String(taskType));
  }
  for (const kinds of Object.values(TASK_KIND_MAP)) for (const kind of kinds) assert.ok(TASK_KINDS.includes(kind), kind);
  assert.deepEqual(taskKindsFor({ taskType: "coding-implement" }), taskKindsFor({ taskType: "coding-implement", weight: "light" }), "weight never widens the map");
});

test("routing sees specific documented claims, observed claims with two reporters and evidenced ratings, never opinions or tips", () => {
  const { feed: clean } = validateFeed(feed([row()]));
  const [model] = clean.models;
  const planning = evidenceFor(model, "planning");
  assert.deepEqual(planning.documented, [{ claim: "Holds long agentic plans over a 1M-token context.", source: "Release notes" }], "a vague claim is left out");
  assert.deepEqual(planning.rating, { n: 5, mean: 4.6, withEvidence: 3 });
  const commits = evidenceFor(model, "commits");
  assert.deepEqual(commits.observed.map((claim) => claim.text), ["Writes commit subjects over 72 characters unless told the limit."], "one reporter and opinions are left out");
  assert.equal(commits.rating, null, "two evidenced ratings are not enough");
  assert.equal(evidenceFor(model, "tests"), null, "tips never reach routing");
  assert.equal(evidenceFor(model, "vibes"), null);
  assert.doesNotMatch(JSON.stringify([planning, commits]), /trust me|failing test first|https:/);
  const routed = routingEvidence(clean, { provider: "claude", model: "claude-opus-5-5", kinds: ["planning", "commits", "tests"] });
  assert.equal(routed.source, "community-reports-not-measurements");
  assert.deepEqual(Object.keys(routed.kinds), ["planning", "commits"]);
  assert.equal(routingEvidence(clean, { provider: "claude", model: "claude-opus-5-5", kinds: [] }), null);
  assert.equal(routingEvidence(null, { provider: "claude", model: "claude-opus-5-5", kinds: ["planning"] }), null);
});

// ---- fetchFeed, stubbed -----------------------------------------------------

const respond = (body, init = {}) => async () => new Response(body, { status: 200, headers: { "content-type": "application/json" }, ...init });

test("fetchFeed reads the contract's URL with https only, a byte cap and a timeout", async () => {
  assert.equal(FEED_URL, "https://nateecho32-stack.github.io/mefi-studio/data/model-community.json");
  let asked = null;
  const ok = await fetchFeed({ fetchImpl: async (url, init) => { asked = { url, init }; return new Response(JSON.stringify(feed([row()])), { status: 200, headers: { etag: "\"abc\"" } }); } });
  assert.equal(ok.ok, true);
  assert.equal(ok.json.schema, 1);
  assert.equal(ok.etag, "\"abc\"");
  assert.equal(asked.url, FEED_URL);
  assert.equal(asked.init.method, "GET");
  assert.equal(asked.init.credentials, "omit");
  assert.equal(asked.init.headers.authorization, undefined);
  const again = await fetchFeed({ etag: "\"abc\"", fetchImpl: async (_url, init) => { asked = init; return new Response(null, { status: 304 }); } });
  assert.equal(asked.headers["if-none-match"], "\"abc\"");
  assert.deepEqual([again.ok, again.notModified], [true, true]);
  assert.equal((await fetchFeed({ url: "http://example.com/feed.json", fetchImpl: () => assert.fail("never fetched") })).ok, false);
  assert.match((await fetchFeed({ fetchImpl: respond("x".repeat(2000)), maxBytes: 1000 })).error, /larger than 1 MB/);
  assert.match((await fetchFeed({ fetchImpl: respond("x", { headers: { "content-length": String(5 * 1024 * 1024) } }) })).error, /larger than 1 MB/);
  assert.match((await fetchFeed({ fetchImpl: respond("{not json") })).error, /not valid JSON/);
  assert.match((await fetchFeed({ fetchImpl: respond("", { status: 500 }) })).error, /HTTP 500/);
  const missing = await fetchFeed({ fetchImpl: respond("", { status: 404 }) });
  assert.equal(missing.missing, true);
  const redirected = await fetchFeed({ fetchImpl: async () => { const response = new Response("{}"); Object.defineProperty(response, "url", { value: "http://evil.example/feed.json" }); return response; } });
  assert.match(redirected.error, /away from https/);
  const slow = await fetchFeed({ timeoutMs: 30, fetchImpl: (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))) });
  assert.match(slow.error, /timed out/);
  assert.match((await fetchFeed({ fetchImpl: async () => { throw new Error("offline"); } })).error, /offline/);
  assert.equal((await fetchFeed({})).ok, false, "no fetch at all is a plain failure");
});
