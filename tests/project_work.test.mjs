// The planning modal's "Already in this project" panel and the assistant's
// "open issues" answer read the repo's own tracker and tooling: the layout
// the engineering skills write (docs/agents/issue-tracker.md, wayfinder maps
// and tickets under .scratch/<effort>/, GitHub issues labelled
// wayfinder:map) and the agents, skills and commands the coding tools there
// can call. Regression for a reported planning modal that "can't detect
// existing maps, tickets and issues".
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import work from "../scripts/project-work.cjs";

const { scanProjectWork, describeProjectWork, readTracker, readRemote, readTooling, _clearCache } = work;

async function repo(t, { tracker = "local" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-project-work-"));
  const home = await mkdtemp(path.join(os.tmpdir(), "mefi-project-work-home-"));
  t.after(async () => { _clearCache(); await rm(root, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); });
  const put = async (file, text) => { const target = path.join(root, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, text); };
  await put("docs/agents/issue-tracker.md", tracker === "local" ? "# Issue tracker: Local Markdown\n\nIssues and specs for this repo live as markdown files in `.scratch/`.\n" : "# Issue tracker: GitHub\n\nIssues live in the repo's GitHub Issues (uses the `gh` CLI).\n");
  await put("docs/agents/triage-labels.md", "# Triage labels\n");
  await put("CONTEXT.md", "# Context\n");
  await put(".scratch/calmer-onboarding/map.md", [
    "# Calmer onboarding",
    "",
    "## Destination",
    "A first five minutes that never asks for a key before it shows value.",
    "",
    "## Notes",
    "Grill before deciding.",
    "",
    "## Decisions so far",
    "- [Which store to read first](issues/01-store-first.md): the OpenCode store, read-only",
    "- [Free model or none](issues/02-free-model.md): free explorer when no key",
    "",
    "## Not yet specified",
    "- how the guide resumes after a crash",
    "- whether the map is per folder",
    "- telemetry",
    "",
    "## Out of scope",
    "- billing",
    "",
  ].join("\n"));
  await put(".scratch/calmer-onboarding/spec.md", "# Calmer onboarding spec\n");
  await put(".scratch/calmer-onboarding/issues/01-store-first.md", "# 01: Which store to read first\n\nType: research\nStatus: resolved\nBlocked by: None (can start immediately)\n\n## Answer\nThe OpenCode store.\n");
  await put(".scratch/calmer-onboarding/issues/02-free-model.md", "# 02: Free model or none\n\nType: grilling\nStatus: claimed\nBlocked by: 01\n");
  await put(".scratch/calmer-onboarding/issues/03-resume-after-crash.md", "# 03: Resume after a crash\n\nType: prototype\nStatus: open\nBlocked by: 02\n");
  await put(".scratch/calmer-onboarding/issues/04-copy-tone.md", "# 04: Copy tone\n\nType: discussion\nBlocked by: 01\n");
  await put(".scratch/notes-only/README.md", "scratch notes, not an effort\n");
  await put(".claude/skills/grill-me/SKILL.md", "---\nname: grill-me\ndescription: Ask me hard questions until the plan is clear.\n---\n# Grill me\n");
  await put(".claude/agents/reviewer.md", "---\nname: reviewer\ndescription: Reviews diffs.\n---\n");
  await put(".claude/commands/ship.md", "# Ship\n");
  await put(".opencode/command/deploy.md", "---\ndescription: Deploy the thing.\n---\n");
  await put("opencode.json", JSON.stringify({ agent: { planner: { description: "Plans work" } }, command: { lint: { template: "npm run lint" } } }));
  await put("AGENTS.md", "# Agents\n");
  const puthome = async (file, text) => { const target = path.join(home, file); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, text); };
  await puthome(".claude/skills/handoff/SKILL.md", "---\nname: handoff\ndescription: Write a handoff.\n---\n");
  await puthome(".config/opencode/agent/explorer.md", "---\ndescription: Explores repos.\n---\n");
  await puthome(".claude/plugins/installed_plugins.json", JSON.stringify({ plugins: { "mattpocock-skills@matt": { installPath: path.join(home, "plugin-checkout") } } }));
  await puthome("plugin-checkout/.claude-plugin/plugin.json", JSON.stringify({ name: "mattpocock-skills" }));
  await puthome("plugin-checkout/skills/engineering/wayfinder/SKILL.md", "---\nname: wayfinder\ndescription: Plan a huge chunk of work as a shared map.\n---\n");
  await puthome("plugin-checkout/skills/engineering/setup-matt-pocock-skills/SKILL.md", "---\nname: setup-matt-pocock-skills\ndescription: Configure this repo.\n---\n");
  await puthome(".claude/plugins/marketplaces/empty-market/README.md", "nothing here\n");
  return { root, home };
}

test("a local-markdown tracker yields its maps, tickets, frontier and docs", async (t) => {
  const { root, home } = await repo(t);
  const result = await scanProjectWork(root, { remote: false, home });
  assert.equal(result.ok, true);
  assert.equal(result.tracker.kind, "local");
  assert.equal(result.tracker.doc, "docs/agents/issue-tracker.md");
  assert.equal(result.tracker.labelsDoc, "docs/agents/triage-labels.md");
  assert.equal(result.tracker.contextDoc, "CONTEXT.md");
  assert.equal(result.efforts.length, 1, "a scratch folder without map, spec or issues is not an effort");
  const [effort] = result.efforts;
  assert.equal(effort.dir, ".scratch/calmer-onboarding");
  assert.equal(effort.map.title, "Calmer onboarding");
  assert.match(effort.map.destination, /first five minutes/);
  assert.equal(effort.map.decisions, 2);
  assert.equal(effort.map.fog, 3);
  assert.equal(effort.map.outOfScope, 1);
  assert.equal(effort.spec.file, ".scratch/calmer-onboarding/spec.md");
  assert.deepEqual(effort.tickets.map((ticket) => [ticket.number, ticket.status, ticket.type, ticket.unblocked]), [
    [1, "resolved", "research", true],
    [2, "claimed", "grilling", true],
    [3, "open", "prototype", false],
    [4, "open", "discussion", true],
  ]);
  assert.equal(effort.tickets[3].title, "Copy tone", "the title drops its NN: prefix");
  assert.deepEqual(effort.counts, { open: 2, claimed: 1, resolved: 1, frontier: 1 });
  assert.deepEqual(result.counts, { maps: 1, specs: 1, open: 3, frontier: 1, resolved: 1 });
  assert.equal(result.remote, null, "no remote read for a local tracker");
  const text = describeProjectWork(result);
  assert.match(text, /Issue tracker: local markdown/);
  assert.match(text, /map "Calmer onboarding" \(2 decided, 3 in the fog\)/);
  assert.match(text, /3 open tickets \(1 on the frontier\), 1 resolved/);
});

test("tooling lists project, user and plugin agents, skills and commands by scope", async (t) => {
  const { root, home } = await repo(t);
  const tooling = await readTooling(root, { home });
  const names = (rows) => rows.map((row) => `${row.name}@${row.scope}`).sort();
  assert.deepEqual(names(tooling.agents), ["explorer@user", "planner@project", "reviewer@project"]);
  assert.deepEqual(names(tooling.skills), ["grill-me@project", "handoff@user", "setup-matt-pocock-skills@plugin", "wayfinder@plugin"]);
  assert.deepEqual(names(tooling.commands), ["deploy@project", "lint@project", "ship@project"]);
  assert.equal(tooling.skills.find((row) => row.name === "wayfinder").source, "mattpocock-skills");
  assert.equal(tooling.skills.find((row) => row.name === "grill-me").description, "Ask me hard questions until the plan is clear.");
  assert.deepEqual(tooling.plugins, [{ name: "mattpocock-skills", skills: 2, agents: 0, commands: 0 }], "a marketplace checkout without skills is not listed");
  assert.deepEqual(tooling.docs, { agentsMd: "AGENTS.md", claudeMd: null, mcp: null });
  assert.deepEqual(tooling.counts, { agents: 3, skills: 4, commands: 3, plugins: 1 });
  assert.ok(!("file" in tooling.skills[0]), "absolute paths stay out of the renderer payload");
  const text = describeProjectWork(await scanProjectWork(root, { remote: false, home, fresh: true }));
  assert.match(text, /Tooling: 3 agents, 4 skills, 3 commands across 1 plugin\./);
});

test("a GitHub tracker lists maps and tickets through gh, and a failed gh is reported not thrown", async (t) => {
  const { root, home } = await repo(t, { tracker: "github" });
  const calls = [];
  const rows = [
    { number: 12, title: "Calmer onboarding", labels: [{ name: "wayfinder:map" }], assignees: [], url: "https://github.com/o/r/issues/12", updatedAt: "2026-09-20T10:00:00Z" },
    { number: 13, title: "Which store first", labels: [{ name: "wayfinder:research" }, { name: "ready-for-agent" }], assignees: [{ login: "j" }], url: "https://github.com/o/r/issues/13", updatedAt: "2026-09-20T10:00:00Z" },
    { number: 14, title: "Export button", labels: [], assignees: [], url: "https://github.com/o/r/issues/14", updatedAt: "2026-09-20T10:00:00Z" },
  ];
  const exec = async (command, args, options) => { calls.push({ command, args, cwd: options.cwd }); return { ok: true, stdout: JSON.stringify(rows), stderr: "", error: null }; };
  const result = await scanProjectWork(root, { home, exec, fresh: true });
  assert.equal(result.tracker.kind, "github");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "gh");
  assert.equal(calls[0].cwd, root);
  assert.ok(calls[0].args.includes("--state") && calls[0].args.includes("open"));
  assert.deepEqual(result.remote.maps.map((map) => map.number), [12]);
  assert.deepEqual(result.remote.tickets.map((issue) => issue.number), [13, 14]);
  assert.deepEqual(result.remote.counts, { open: 2, wayfinder: 1, readyForAgent: 1, claimed: 1 });
  assert.equal(result.counts.maps, 2, "local and GitHub maps add up");
  assert.equal(result.counts.open, 5);
  const text = describeProjectWork(result);
  assert.match(text, /Issue tracker: GitHub issues/);
  assert.match(text, /GitHub: 2 open issues, 1 wayfinder map: "Calmer onboarding", 1 ready-for-agent\./);
  const failed = await readRemote(root, await readTracker(root), { exec: async () => ({ ok: false, stdout: "", stderr: "gh: not logged in", error: "gh: not logged in" }) });
  assert.equal(failed.ok, false);
  assert.equal(failed.error, "gh: not logged in");
  assert.match(describeProjectWork({ ...result, remote: failed }), /GitHub issues could not be listed \(gh: not logged in\)/);
});

test("a folder with none of the conventions reads as empty, and a missing folder as not ok", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-project-work-bare-"));
  const home = await mkdtemp(path.join(os.tmpdir(), "mefi-project-work-bare-home-"));
  t.after(async () => { _clearCache(); await rm(root, { recursive: true, force: true }); await rm(home, { recursive: true, force: true }); });
  const result = await scanProjectWork(root, { home, fresh: true });
  assert.equal(result.ok, true);
  assert.equal(result.tracker.kind, null);
  assert.deepEqual(result.efforts, []);
  assert.equal(result.remote, null);
  assert.deepEqual(result.tooling.counts, { agents: 0, skills: 0, commands: 0, plugins: 0 });
  assert.equal(describeProjectWork(result), null);
  const missing = await scanProjectWork(path.join(root, "nope"), { home });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not available/);
  assert.equal(describeProjectWork(missing), null);
});

test("scans are cached per folder for a minute unless asked fresh", async (t) => {
  const { root, home } = await repo(t);
  const first = await scanProjectWork(root, { remote: false, home, now: 1000 });
  await writeFile(path.join(root, ".scratch", "calmer-onboarding", "issues", "05-late.md"), "# 05: Late\n\nStatus: open\n");
  const cached = await scanProjectWork(root, { remote: false, home, now: 2000 });
  assert.equal(cached, first);
  const fresh = await scanProjectWork(root, { remote: false, home, now: 2000, fresh: true });
  assert.equal(fresh.efforts[0].tickets.length, 5);
  const expired = await scanProjectWork(root, { remote: false, home, now: 2000 + 61_000 });
  assert.equal(expired.efforts[0].tickets.length, 5);
});
