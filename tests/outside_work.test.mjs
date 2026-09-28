// Work done outside Studio (scripts/outside-work.cjs): reading git, the
// report a saved look and the folder now make, the evidence a card shares
// with it, the model's checked verdicts, the stamps and holds, and the words
// the thread, the chat, the digest and the worker read. Pure: no git, no
// clock, no filesystem.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const outside = require("../scripts/outside-work.cjs");
const backlog = require("../scripts/backlog.cjs");
const companion = require("../scripts/companion.cjs");
const core = require("../scripts/executor-core.cjs");
const autonomy = require("../scripts/autonomy.cjs");

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const NOW = Date.UTC(2026, 8, 27, 12, 0, 0);
const SINCE = NOW - 3 * HOUR;
const HEAD_A = "a".repeat(40);
const HEAD_B = "b".repeat(40);

const commit = (hash, subject, files, at = NOW - HOUR) => ({ hash, short: hash.slice(0, 7), at, author: "Owner", subject, files });
const previous = (extra = {}) => outside.look({ at: SINCE, head: HEAD_A, branch: "main", dirty: ["notes.md"], ...extra });
const current = (extra = {}) => outside.look({ at: NOW, head: HEAD_B, branch: "main", dirty: ["notes.md", "src/new.js"], ...extra });

test("git log and status output parse into commits and changed paths", () => {
  const log = [
    `\u001e${"c".repeat(40)}\u001f${Math.floor((NOW - HOUR) / 1000)}\u001fOwner\u001fFix the login redirect\n\nsrc\\auth\\login.js\nsrc/auth/session.js\n`,
    `\u001e${"d".repeat(40)}\u001f${Math.floor((NOW - 2 * HOUR) / 1000)}\u001fOwner\u001fSubject with\u001fa separator\n\nREADME.md\n`,
    "\u001enot-a-hash\u001f1\u001fx\u001fy\n",
  ].join("");
  const commits = outside.parseLog(log);
  assert.equal(commits.length, 2, "a record without a hash is skipped");
  assert.deepEqual(commits[0].files, ["src/auth/login.js", "src/auth/session.js"], "paths use forward slashes");
  assert.equal(commits[0].short, "ccccccc");
  assert.equal(commits[0].at, Math.floor((NOW - HOUR) / 1000) * 1000);
  assert.equal(commits[1].subject, "Subject with\u001fa separator".replace(/\u001f/g, " "), "control characters in a subject are spaced out");

  const status = outside.parseStatus(" M src/a.js\u0000?? scratch/\u0000R  src/new-name.js\u0000src/old-name.js\u0000 D gone.txt\u0000");
  assert.deepEqual(status.map((row) => row.path), ["src/a.js", "scratch/", "src/new-name.js", "gone.txt"], "a rename's source path is not a row of its own");
  assert.deepEqual(outside.parseStatus(""), []);
});

test("a look keeps the head, branch and a bounded, sorted set of uncommitted paths", () => {
  const seen = outside.look({ at: NOW, head: HEAD_A.toUpperCase(), branch: "main", dirty: [{ path: "b.js" }, "a.js", "a.js", ".\\c.js"] });
  assert.equal(seen.head, HEAD_A);
  assert.deepEqual(seen.dirty, ["a.js", "b.js", "c.js"]);
  assert.equal(outside.look({ at: NOW, head: "HEAD" }).head, null, "only a hash is a head");
  assert.equal(outside.look({ at: NOW, dirty: Array.from({ length: 900 }, (_, i) => `f${i}.js`) }).dirty.length, outside.LIMITS.dirty);
});

test("the report names commits, uncommitted edits made while away and outside sessions", () => {
  const rep = outside.report({
    previous: previous(),
    current: current(),
    commits: [commit("c".repeat(40), "Fix the login redirect", ["src/auth/login.js"]), commit("d".repeat(40), "Tidy the readme", ["README.md"])],
    stats: { "notes.md": { mtimeMs: SINCE - MINUTE, code: " M" }, "src/new.js": { mtimeMs: NOW - MINUTE, code: "??" } },
    sessions: [
      { tool: "claude", id: "claude:1", title: "Rework the login flow", at: NOW - 2 * HOUR },
      { tool: "opencode", id: "ses_old", title: "Before the look", at: SINCE - HOUR },
    ],
    now: NOW,
  });
  assert.equal(rep.since, SINCE);
  assert.equal(rep.awayMs, 3 * HOUR);
  assert.equal(rep.commitCount, 2);
  assert.deepEqual(rep.uncommitted, [{ path: "src/new.js", change: "new" }], "a path edited before the look is not outside work");
  assert.deepEqual(rep.sessions.map((row) => row.id), ["claude:1"], "a session that ended before the look is not outside work");
  assert.deepEqual(rep.files.sort(), ["README.md", "src/auth/login.js", "src/new.js"].sort());
  assert.match(rep.headline, /^While Studio was away \(3 h\): 2 commits, 3 files changed, 1 uncommitted, 1 outside agent session\.$/);
  assert.ok(rep.lines.some((line) => line.startsWith("Commit ccccccc: Fix the login redirect")));
  assert.ok(rep.lines.some((line) => line === "Claude Code session: Rework the login flow"));
});

test("other agents' transcripts give a title in the owner's words, and Codex its working folder", () => {
  const claude = [
    JSON.stringify({ type: "summary", summary: "x" }),
    JSON.stringify({ type: "user", isMeta: true, message: { content: "Caveat: the messages below were generated" } }),
    JSON.stringify({ type: "user", message: { content: "<command-name>/clear</command-name>" } }),
    "{not json",
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "x" }, { type: "text", text: "  Fix the\nlogin redirect  " }] } }),
  ];
  assert.equal(outside.claudeTitle(claude), "Fix the login redirect");
  assert.equal(outside.claudeTitle([]), "");

  const codex = [
    JSON.stringify({ type: "session_meta", payload: { id: "0199", cwd: "E:\\Work\\App", base_instructions: { text: "long" } } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "system words" }] } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context>cwd</environment_context>" }, { type: "input_text", text: "Wire the export button" }] } }),
  ];
  assert.deepEqual(outside.codexSession(codex), { id: "0199", cwd: "E:\\Work\\App", title: "Wire the export button" });
  assert.equal(outside.codexSession([JSON.stringify({ type: "response_item" })]), null, "no session_meta, no session");

  assert.equal(outside.withinFolder("E:\\Work\\App", "e:/work/app/"), true);
  assert.equal(outside.withinFolder("E:\\Work\\App\\sub", "E:\\Work\\App"), true);
  assert.equal(outside.withinFolder("E:\\Work\\Apple", "E:\\Work\\App"), false, "a sibling with the same prefix is not inside");
  assert.equal(outside.withinFolder("", "E:\\Work"), false);
});

test("only a report that changed code is a reason to check the queue", () => {
  const sessionsOnly = outside.report({ previous: previous({ dirty: [] }), current: outside.look({ at: NOW, head: HEAD_A, branch: "main" }),
    sessions: [{ tool: "codex", id: "codex:1", title: "Talk it through", at: NOW - HOUR }], now: NOW });
  assert.ok(sessionsOnly, "an outside session is still news");
  assert.match(sessionsOnly.headline, /1 outside agent session/);
  assert.ok(sessionsOnly.lines.includes("Codex session: Talk it through"));
  assert.equal(outside.changesCode(sessionsOnly), false);
  assert.equal(outside.changesCode({ ...sessionsOnly, commitCount: 1 }), true);
  assert.equal(outside.changesCode({ ...sessionsOnly, uncommitted: [{ path: "a.js" }] }), true);
  assert.equal(outside.changesCode({ ...sessionsOnly, head: { from: HEAD_A, to: HEAD_B } }), true, "a checkout that moved changes the code");
  assert.equal(outside.changesCode(null), false);
});

test("no earlier look, or nothing changed, makes no report", () => {
  assert.equal(outside.report({ previous: null, current: current(), now: NOW }), null, "the first look is only a baseline");
  const same = outside.look({ at: NOW, head: HEAD_A, branch: "main", dirty: ["notes.md"] });
  assert.equal(outside.report({ previous: previous(), current: same, stats: { "notes.md": { mtimeMs: SINCE - MINUTE } }, now: NOW }), null);
  const moved = outside.report({ previous: previous(), current: { ...same, branch: "feature" }, stats: { "notes.md": { mtimeMs: SINCE - MINUTE } }, now: NOW });
  assert.match(moved.headline, /the branch changed from main to feature/);
});

test("an unreadable path counts only when it newly became uncommitted, and a rewritten history is said", () => {
  const rep = outside.report({
    previous: previous({ dirty: ["kept-deleted.txt"] }),
    current: outside.look({ at: NOW, head: HEAD_B, branch: "main", dirty: ["kept-deleted.txt", "now-deleted.txt"] }),
    stats: { "kept-deleted.txt": { mtimeMs: null, code: " D" }, "now-deleted.txt": { mtimeMs: null, code: " D" } },
    rewritten: true,
    commits: [commit("e".repeat(40), "Squashed work", ["x.js"])],
    now: NOW,
  });
  assert.deepEqual(rep.uncommitted, [{ path: "now-deleted.txt", change: "deleted" }]);
  assert.equal(rep.rewritten, true);
  assert.match(rep.lines[0], /History was rewritten/);
  const many = outside.report({ previous: previous(), current: current(), commits: Array.from({ length: 60 }, (_, i) => commit(i.toString(16).padStart(40, "0"), `c${i}`, [])), commitCount: 75, now: NOW, stats: {} });
  assert.equal(many.commits.length, outside.LIMITS.commits);
  assert.equal(many.commitCount, 75);
  assert.match(many.headline, /40\+ commits/);
});

const REP = outside.report({
  previous: previous(),
  current: current(),
  commits: [
    commit("c".repeat(40), "Add the dark theme toggle to settings", ["renderer/settings.js", "renderer/styles.css"]),
    commit("f".repeat(40), "Refactor the router", ["renderer/router.js"]),
  ],
  stats: { "src/new.js": { mtimeMs: NOW - MINUTE, code: "??" } },
  sessions: [{ tool: "claude", id: "claude:9", title: "Remove the legacy exporter entirely", at: NOW - HOUR }],
  now: NOW,
});
const card = (id, title, extra = {}) => ({ id, title, status: "open", createdAt: SINCE - HOUR, ...extra });

test("evidence finds shared files and subjects; only a subject that says what the title says is strong", () => {
  const theme = outside.evidence(card("t1", "Dark theme toggle in settings", { files: ["C:/proj/renderer/settings.js"] }), REP, { root: "C:/proj" });
  assert.deepEqual(theme.files, ["renderer/settings.js"], "an absolute card path matches the repo-relative one");
  assert.equal(theme.commits[0].short, "ccccccc");
  assert.equal(theme.strong, true);
  const router = outside.evidence(card("t2", "Speed up page loads", { files: ["router.js"] }), REP);
  assert.deepEqual(router.files, ["renderer/router.js"], "a bare file name matches at a folder boundary");
  assert.equal(router.strong, false, "sharing a file is not being done");
  assert.equal(router.any, true);
  const unrelated = outside.evidence(card("t3", "Write the installer"), REP);
  assert.equal(unrelated.any, false);
  const exporter = outside.evidence(card("t4", "Fix the legacy exporter crash"), REP);
  assert.deepEqual(exporter.sessions, [{ tool: "claude", title: "Remove the legacy exporter entirely" }]);

  assert.equal(outside.localVerdict(theme).verdict, "done");
  assert.equal(outside.localVerdict(theme).by, "local");
  assert.equal(outside.localVerdict(router).verdict, "needed");
  assert.match(outside.localVerdict(router).reason, /router\.js/);
  assert.equal(outside.localVerdict(unrelated).reason, "");
});

test("candidates are the queued cards not yet checked against this report", () => {
  const tasks = [
    card("open"), card("pinned", "p", { status: "pending" }), card("running", "r", { status: "active" }),
    card("done", "d", { status: "done" }), card("grouped", "g", { absorbedInto: "x" }),
    card("seen", "s", { relevance: { reportAt: REP.at } }), card("newer", "n", { createdAt: REP.at + 1 }),
    card("again", "a", { relevance: { reportAt: REP.at - 1, state: "clear" } }),
  ];
  assert.deepEqual(outside.candidates(tasks, REP).map((task) => task.id), ["open", "pinned", "again"]);
  assert.deepEqual(outside.candidates(tasks, null), []);
});

test("a checking hold defers the card until its limit; a done or obsolete verdict blocks it for the owner", () => {
  const checking = outside.checkingStamp(REP, NOW);
  assert.equal(checking.until, NOW + outside.CHECK_HOLD_MS);
  const held = backlog.workState(card("t", "Title", { relevance: checking }), NOW);
  assert.equal(held.stage, "deferred");
  assert.equal(held.blockedBy, "relevance-check");
  assert.equal(backlog.workState(card("t", "Title", { relevance: checking }), checking.until + 1).stage, "ready", "a check that never ran cannot hold the card for good");

  const done = outside.verdictStamp({ stamp: checking, verdict: "done", reason: "Commit ccccccc adds the toggle", by: "model", rep: REP, now: NOW, commits: ["ccccccc", "9999999"] });
  assert.equal(done.state, "ask");
  assert.deepEqual(done.commits, [{ short: "ccccccc", subject: "Add the dark theme toggle to settings" }], "only commits in the report are cited");
  const blocked = backlog.workState(card("t", "Title", { relevance: done }), NOW);
  assert.equal(blocked.stage, "blocked");
  assert.equal(blocked.blockedBy, "relevance");
  assert.match(blocked.reason, /Looks already done outside Studio/);
  assert.match(backlog.workState(card("t", "Title", { relevance: { ...done, verdict: "obsolete" } }), NOW).reason, /May no longer be needed/);
  assert.match(backlog.workState(card("t", "Title", { relevance: { ...done, by: "local" } }), NOW).reason, /^May already be done outside Studio/, "a local match is only a maybe");

  const partial = outside.verdictStamp({ stamp: checking, verdict: "partial", reason: "the toggle exists; persistence is missing", rep: REP, now: NOW });
  assert.equal(partial.state, "clear");
  assert.equal(backlog.workState(card("t", "Title", { relevance: partial }), NOW).stage, "ready");
  assert.equal(outside.verdictStamp({ verdict: "nonsense", now: NOW }).verdict, "needed");

  const stopped = backlog.workState(card("t", "Title", { relevance: done, ownerHold: { at: NOW } }), NOW);
  assert.equal(stopped.blockedBy, "owner", "the owner's own stop names who holds the card");
  assert.equal(backlog.workState(card("t", "Title", { relevance: done, status: "active" }), NOW).stage, "running", "only a queued card is held");
});

test("Try again and the owner's word lift the hold but keep the evidence; the desk cannot", () => {
  const done = outside.verdictStamp({ verdict: "done", reason: "already there", rep: REP, now: NOW, found: { files: ["renderer/settings.js"], commits: [] } });
  const retried = backlog.retryTask(card("t", "Title", { relevance: done }), NOW + 1);
  assert.equal(retried.relevance.state, "clear");
  assert.equal(retried.relevance.released.by, "owner");
  assert.deepEqual(retried.relevance.files, ["renderer/settings.js"]);
  assert.equal(backlog.workState(retried, NOW + 1).stage, "ready");

  const desk = backlog.delegateRetry(card("t", "Title", { relevance: done, runFailures: 5 }), NOW);
  assert.equal(desk.ok, false);
  assert.equal(desk.held, true);

  assert.equal(outside.release(done, NOW, "owner").state, "clear");
  assert.equal(outside.release({ ...done, state: "clear" }, NOW), null, "nothing to lift");
  assert.equal(outside.release(null, NOW), null);
});

test("the model's verdicts are checked against the offered cards, the four verdicts and the report's commits", () => {
  const cards = [card("t1", "One"), card("t2", "Two"), card("t3", "Three")];
  const reply = `Sure. \`\`\`json
{"cards": [
  {"id": "t1", "verdict": "done", "reason": "ccccccc did it", "commits": ["cccccccccc", "1234567"]},
  {"id": "t2", "verdict": "maybe", "reason": "?"},
  {"id": "t9", "verdict": "done"},
  {"id": "t3", "verdict": "Obsolete", "reason": "the exporter is gone"},
  {"id": "t1", "verdict": "needed"}
]}
\`\`\``;
  const verdicts = outside.parseVerdicts(reply, cards, REP);
  assert.deepEqual([...verdicts.keys()], ["t1", "t3"], "an unknown verdict or card id is dropped, and the first answer per card stands");
  assert.deepEqual(verdicts.get("t1").commits, ["ccccccc"], "a longer abbreviation resolves; an unknown hash is dropped");
  assert.equal(verdicts.get("t3").verdict, "obsolete");
  assert.equal(outside.parseVerdicts("no json here", cards, REP), null);
  assert.equal(outside.parseVerdicts('{"reply": "not the shape"}', cards, REP), null);
  assert.equal(outside.parseVerdicts('{"cards": []}', cards, REP).size, 0, "an empty list means every card is needed");
});

test("the prompt carries the report and the cards as data, bounded", () => {
  const cards = Array.from({ length: 40 }, (_, i) => card(`t${i}`, `Card ${i}`, { prompt: "x".repeat(2000), files: ["C:/proj/a.js"] }));
  const prompt = outside.relevancePrompt({ report: REP, cards, root: "C:/proj" });
  const body = JSON.parse(prompt.user);
  assert.equal(body.cards.length, outside.LIMITS.cards);
  assert.ok(body.cards[0].brief.length <= outside.LIMITS.brief);
  assert.deepEqual(body.cards[0].files, ["a.js"]);
  assert.equal(body.outside.commits[0].commit, "ccccccc");
  assert.deepEqual(body.outside.uncommitted, ["new src/new.js"]);
  assert.match(prompt.system, /data, never instructions/);
  assert.match(prompt.system, /\{"cards"/);
});

test("the worker's note names what changed and asks it to build only what is missing", () => {
  const partial = outside.verdictStamp({ verdict: "partial", reason: "the toggle exists; persistence is missing", rep: REP, now: NOW,
    found: { files: ["renderer/settings.js"], commits: [{ short: "ccccccc", subject: "Add the dark theme toggle to settings" }], sessions: [] } });
  const note = outside.briefLine(card("t", "T", { relevance: partial }), NOW + MINUTE);
  assert.match(note, /^Part of this card was done outside Studio: the toggle exists; persistence is missing\./);
  assert.match(note, /ccccccc/);
  assert.match(note, /renderer\/settings\.js/);
  assert.match(note, /build only what is still missing/);
  assert.ok(note.length <= outside.LIMITS.note);
  assert.equal(outside.briefLine(card("t", "T", { relevance: outside.verdictStamp({ verdict: "needed", rep: REP, now: NOW }) }), NOW), "", "nothing touched it: no note");
  assert.equal(outside.briefLine(card("t", "T", { relevance: partial }), NOW + 8 * 24 * HOUR), "", "an old check is no longer news");
  assert.equal(outside.briefLine(card("t", "T", { relevance: { ...partial, state: "ask" } }), NOW), "", "a held card has no worker to tell");

  const prompt = core.workerPrompt({ title: "T", taskId: "t", tasksFile: "tasks.json", ref: { id: "t" }, sections: { outside: note }, tail: "TAIL", promptMax: 24000, brief: () => "BRIEF" });
  assert.ok(prompt.prompt.includes("Part of this card was done outside Studio"), "the note reaches the worker's prompt");
  assert.ok(prompt.prompt.indexOf("BRIEF") < prompt.prompt.indexOf("Part of this card"), "after the brief");
  const plain = core.workerPrompt({ title: "T", taskId: "t", tasksFile: "tasks.json", ref: { id: "t" }, sections: {}, tail: "TAIL", promptMax: 24000, brief: () => "BRIEF" });
  assert.ok(!plain.prompt.includes("outside Studio"));
});

test("the dispatcher says it is checking when only held cards wait", () => {
  const checking = card("t", "Title", { relevance: outside.checkingStamp(REP, NOW) });
  assert.equal(core.idleStopReason({ open: [checking], tasks: [checking], now: NOW, autoBuild: true }), "checking");
});

test("the Ask card offers the owner's three real answers and stays with the owner in every mode", () => {
  const stamp = outside.verdictStamp({ verdict: "done", reason: "Commit ccccccc adds it", by: "model", rep: REP, now: NOW, commits: ["ccccccc"] });
  const ask = outside.question(card("t1", "Dark theme toggle"), stamp);
  assert.equal(ask.source, "relevance");
  assert.equal(ask.title, '"Dark theme toggle" looks already done outside Studio');
  assert.deepEqual(ask.options.map((option) => option.id), ["close", "drop", "build", "hold"]);
  assert.equal(ask.options.find((option) => option.recommended).id, "close");
  assert.deepEqual(ask.options[0].action, { kind: "relevance", action: "mark_done", taskId: "t1" });
  assert.equal(ask.context.taskId, "t1");
  assert.equal(ask.context.issueKind, "relevance");
  assert.ok(ask.context.evidence[0].startsWith("Commit ccccccc"));
  const obsolete = outside.question(card("t1", "Old exporter"), { ...stamp, verdict: "obsolete" });
  assert.match(obsolete.title, /may no longer be needed/);
  assert.equal(obsolete.options.find((option) => option.recommended).id, "drop");
  assert.match(outside.question(card("t1", "X"), { ...stamp, by: "local" }).title, /may already be done/);

  for (const level of ["ask", "accept", "auto", "elevated"]) {
    assert.equal(autonomy.route({ level, item: { ...ask, id: "q1", status: "open" }, task: card("t1", "X", { origin: { by: "agent" } }), accepted: true }), "owner", `${level} leaves it with the owner`);
  }
});

test("a card waiting on the owner's word is held in the needs-you queue", () => {
  const stamp = outside.verdictStamp({ verdict: "obsolete", rep: REP, now: NOW });
  const listed = companion.queue({ tasks: [card("t1", "Old exporter", { relevance: stamp })], now: NOW + MINUTE });
  assert.equal(listed.counts.held, 1);
  const checking = companion.queue({ tasks: [card("t1", "Old exporter", { relevance: outside.checkingStamp(REP, NOW) })], now: NOW + MINUTE });
  assert.equal(checking.counts.total, 0, "a card only being checked needs nobody");
});

test("the thread, the chat and the welcome-back digest each get their own words", () => {
  const notice = outside.reportNotice(REP, { checking: 3 });
  assert.ok(notice.startsWith(REP.headline));
  assert.match(notice, /Checking the 3 queued cards against it/);
  assert.match(outside.reportNotice(REP, { checking: 1, waiting: true }), /when the agents start/);
  const verdicts = outside.verdictNotice([
    { verdict: "needed", title: "A", by: "model" }, { verdict: "partial", title: "B", by: "model" },
    { verdict: "done", title: "Dark theme toggle", by: "model" }, { verdict: "obsolete", title: "Old exporter", by: "model" },
  ]);
  assert.match(verdicts, /^Checked 4 queued cards against the work done outside Studio: 1 still needed, 1 partly done/);
  assert.match(verdicts, /"Dark theme toggle" and "Old exporter" wait for you in Needs you\./);
  assert.match(outside.verdictNotice([{ verdict: "needed", title: "A", by: "local" }]), /no model answered/);
  assert.match(outside.verdictNotice([{ verdict: "done", title: "A", by: "local" }, { verdict: "done", title: "B", by: "model" }]), /1 looks already done, 1 may already be done\./, "a local match is only a maybe, as on its card");

  const stamped = [card("t1", "Dark theme toggle", { relevance: { ...outside.verdictStamp({ verdict: "done", reason: "done by ccccccc", rep: REP, now: NOW }) } })];
  const facts = outside.chatFacts(REP, stamped, NOW + HOUR);
  assert.equal(facts.headline, REP.headline);
  assert.equal(facts.commits[0].commit, "ccccccc");
  assert.deepEqual(facts.cards, [{ taskId: "t1", title: "Dark theme toggle", check: "done", waitsForOwner: true, reason: "done by ccccccc" }]);
  assert.ok(outside.chatFacts(REP, stamped, NOW + 3 * 24 * HOUR), "an answer still owed keeps an old report in view");
  assert.equal(outside.chatFacts(REP, [], NOW + 3 * 24 * HOUR), null, "a stale report with nothing owed is gone");

  for (const question of ["what did I do while Studio was closed?", "What changed while I was away", "anything happen outside studio?", "what have we worked on since I left", "what's changed"]) {
    assert.equal(outside.asksAboutAway(question), true, question);
  }
  for (const other of ["start the export task", "why is the login card parked?", "what's next"]) assert.equal(outside.asksAboutAway(other), false, other);
  const answer = outside.awayAnswer("what changed while I was away?", facts);
  assert.ok(answer.startsWith(REP.headline));
  assert.match(answer, /Commits: ccccccc "Add the dark theme toggle to settings", fffffff "Refactor the router"\./);
  assert.match(answer, /Uncommitted: new src\/new\.js\./);
  assert.match(answer, /Other agents: Claude Code "Remove the legacy exporter entirely"\./);
  assert.match(answer, /Waiting for you: "Dark theme toggle" \(looks already done\)\./);
  assert.equal(outside.awayAnswer("start the export task", facts), "", "not the question: no answer");
  assert.equal(outside.awayAnswer("what changed while I was away?", null), "", "no report: no answer");

  const part = outside.digestPart(REP);
  const digest = companion.digest({ events: [], tasks: [], since: SINCE, now: NOW, outside: part });
  assert.match(digest.headline, /^While you were away \(3 h\): 2 commits outside Studio\.$/);
  assert.ok(digest.lines[0].startsWith("Outside Studio: Commit ccccccc"));
  assert.equal(digest.outside.phrase, "2 commits outside Studio");
  assert.equal(companion.digest({ events: [], tasks: [], since: SINCE, now: NOW }).outside, undefined);
});
