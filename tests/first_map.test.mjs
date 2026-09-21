import test from "node:test";
import assert from "node:assert/strict";
import {
  buildFirstMapPrompt, extractJsonObjects, parseFirstMap, ideasFrom, ideaIdFor, mergeIdeas, firstMapSummary, FIRST_MAP_LIMITS, FIRST_MAP_SOURCE,
} from "../scripts/first-map.mjs";

const REPORT = {
  inventory: {
    files: 974, sourceFiles: 900, testFiles: 40, documents: 30,
    languages: [{ name: "Lua", count: 880 }, { name: "PowerShell", count: 20 }],
    entryPoints: ["main.lua", "conf.lua", "README.md"],
    checks: [{ name: "test", command: "npm run test" }],
  },
  plans: [{ title: "PLAN.md", status: "open" }, { title: "Roadmap", status: "related" }],
  startingPoints: [{ title: "Continue: wire the night spawn table" }],
  limitations: ["Static local analysis only.", "Partial scan: the 1,200-file bound was reached."],
};

test("buildFirstMapPrompt states the rules, pastes the inventory and asks for todos plus one JSON object", () => {
  const prompt = buildFirstMapPrompt({ project: { name: "2d Trippy Hell" }, report: REPORT, model: "opencode/nemotron-3.5-lightning-free" });
  assert.match(prompt, /mapping the project "2d Trippy Hell"/);
  assert.match(prompt, /Read only\. Use read, glob, grep and list/);
  assert.match(prompt, /untrusted data/);
  assert.match(prompt, /at most 12 items, one per area or check, prefixed "Map:"/);
  assert.match(prompt, /Files inspected: 974 \(source 900, tests 40, documents 30\)/);
  assert.match(prompt, /Languages: Lua 880, PowerShell 20/);
  assert.match(prompt, /Entry points found: main\.lua, conf\.lua, README\.md/);
  assert.match(prompt, /Declared checks \(discovered, not run\): npm run test/);
  assert.match(prompt, /Plan documents: PLAN\.md \[open\]; Roadmap \[related\]/);
  assert.match(prompt, /Starting points the local scan suggested: Continue: wire the night spawn table/);
  assert.match(prompt, /1,200-file bound/);
  assert.match(prompt, /"firstTasks":\[/);
  assert.match(prompt, /Do not wrap the JSON in code fences/);
  assert.match(prompt, /Model: opencode\/nemotron-3\.5-lightning-free/);
  assert.ok(prompt.length <= FIRST_MAP_LIMITS.promptChars);
  const empty = buildFirstMapPrompt({ project: {}, report: null });
  assert.match(empty, /mapping the project "this project"/);
  assert.match(empty, /produced no inventory/);
});

test("extractJsonObjects finds balanced top-level objects and ignores braces inside strings", () => {
  const text = 'Thinking about {"a":1}... here: {"summary":"has } brace","areas":[{"name":"x"}]} done';
  assert.deepEqual(extractJsonObjects(text), ['{"a":1}', '{"summary":"has } brace","areas":[{"name":"x"}]}']);
  assert.deepEqual(extractJsonObjects("no objects } here {"), []);
  assert.deepEqual(extractJsonObjects('{"escaped":"quote \\" inside"}'), ['{"escaped":"quote \\" inside"}']);
});

const GOOD = {
  summary: "A LÖVE game with a large Lua codebase.",
  areas: [{ name: "Worldgen", path: "game/worldgen", what: "Procedural overworld." }, { name: "Render", path: "render/", what: "Tile cache and decorations." }],
  entryPoints: ["main.lua", "conf.lua"],
  checks: [{ name: "test", command: "npm run test", seen: "package.json" }, "tools/test.ps1"],
  risks: ["No CI runs the Lua checks."],
  firstTasks: [
    { title: "Document how to run the game", why: "README lacks a run section.", check: "README names the run command.", files: ["README.md"] },
    { title: "", why: "dropped" },
    { title: "Add a smoke test for world load", why: "None exists.", check: "node tools/smoke.mjs exits 0", files: ["tools/smoke.mjs", "main.lua"] },
  ],
};

test("parseFirstMap takes the last map-shaped object, even narrated and fenced, and normalizes it", () => {
  const text = `I looked around. {"note":"not a map"}\n\`\`\`json\n${JSON.stringify(GOOD)}\n\`\`\`\nThat is all.`;
  const parsed = parseFirstMap(text);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.map.summary, GOOD.summary);
  assert.deepEqual(parsed.map.areas.map((area) => area.name), ["Worldgen", "Render"]);
  assert.deepEqual(parsed.map.entryPoints, ["main.lua", "conf.lua"]);
  assert.deepEqual(parsed.map.checks[1], { name: "tools/test.ps1", command: "tools/test.ps1", seen: "" });
  assert.deepEqual(parsed.map.risks, ["No CI runs the Lua checks."]);
  assert.equal(parsed.map.firstTasks.length, 2);
  assert.deepEqual(parsed.map.firstTasks[1].files, ["tools/smoke.mjs", "main.lua"]);
  assert.deepEqual(parsed.warnings, ["firstTasks: dropped an entry without a title"]);
});

test("parseFirstMap fails closed on prose, broken JSON, non-map objects and empty maps; caps oversized lists", () => {
  assert.equal(parseFirstMap("nothing here").ok, false);
  assert.match(parseFirstMap("nothing here").error, /no JSON object/);
  assert.match(parseFirstMap('{"summary": "unterminated').error, /no JSON object/);
  assert.match(parseFirstMap('{"summary": bad}').error, /did not parse/);
  assert.match(parseFirstMap('{"unrelated": true}').error, /not a map/);
  const empty = parseFirstMap('{"summary":"","areas":[],"firstTasks":[]}');
  assert.equal(empty.ok, false);
  assert.match(empty.error, /empty/);
  const big = parseFirstMap(JSON.stringify({ summary: "x", risks: Array.from({ length: 20 }, (_, i) => `risk ${i}`), areas: Array.from({ length: 30 }, (_, i) => ({ name: `a${i}` })) }));
  assert.equal(big.ok, true);
  assert.equal(big.map.risks.length, FIRST_MAP_LIMITS.risks);
  assert.equal(big.map.areas.length, FIRST_MAP_LIMITS.areas);
  assert.ok(big.warnings.some((note) => /risks: kept 8 of 20/.test(note)));
  assert.ok(big.warnings.some((note) => /areas: kept 12 of 30/.test(note)));
});

test("ideasFrom mints stable, project-stamped idea rows and mergeIdeas keeps the owner's status", () => {
  const { map } = parseFirstMap(JSON.stringify(GOOD));
  const ideas = ideasFrom(map, { projectId: "project_1", projectPath: "C:\\proj", sessionId: "ses_1", model: "opencode/mimo-v2.5-free", now: 1000 });
  assert.equal(ideas.length, 2);
  assert.equal(ideas[0].id, ideaIdFor("project_1", "Document how to run the game"));
  assert.equal(ideas[0].id, ideaIdFor("project_1", "document how to run the game "));
  assert.notEqual(ideas[0].id, ideaIdFor("project_2", "Document how to run the game"));
  assert.equal(ideas[0].source, FIRST_MAP_SOURCE);
  assert.equal(ideas[0].status, "new");
  assert.equal(ideas[0].read, false);
  assert.match(ideas[0].detail, /README lacks a run section\. Check: README names the run command\. Files: README\.md/);
  assert.deepEqual(ideas[0].tags, ["first-map", "files"]);
  assert.equal(ideas[0].projectId, "project_1");
  assert.equal(ideas[0].sessionId, "ses_1");
  assert.equal(ideas[0].at, 1000);
  const existing = [{ ...ideas[0], status: "keep", read: true, taskId: "task_9", detail: "old detail" }, { id: "idea_other", title: "Other", status: "new" }];
  const merged = mergeIdeas(existing, ideas);
  assert.equal(merged.added, 1);
  assert.equal(merged.updated, 1);
  assert.equal(merged.ideas.length, 3);
  assert.equal(merged.ideas[0].status, "keep");
  assert.equal(merged.ideas[0].taskId, "task_9");
  assert.equal(merged.ideas[0].detail, ideas[0].detail);
  assert.equal(merged.ideas[2].title, "Add a smoke test for world load");
  assert.deepEqual(ideasFrom(null), []);
  assert.deepEqual(mergeIdeas(undefined, []), { ideas: [], added: 0, updated: 0 });
});

test("firstMapSummary counts what the map holds", () => {
  const { map } = parseFirstMap(JSON.stringify(GOOD));
  assert.equal(firstMapSummary(map), "2 areas, 2 entry points, 2 checks, 2 first tasks saved as ideas.");
  assert.equal(firstMapSummary({ areas: [], entryPoints: [], checks: [], firstTasks: [] }), "no first tasks.");
  assert.equal(firstMapSummary(null), "No map.");
});
