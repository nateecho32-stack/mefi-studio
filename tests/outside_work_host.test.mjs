// The host half of work done outside Studio: main.cjs's "work done outside
// Studio" block, sliced into a vm and run against a real git repository in a
// temp folder, a fake home (for a Claude Code transcript) and memory stores.
// It proves the whole path: a baseline look, commits and edits made while
// Studio was away, the report and its thread notice, every queued card held
// and checked (by a model reply, and by local matching when none answers),
// the Ask card, the owner's answers, the refresh rules and the quit write.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";

const mainUrl = new URL("../main.cjs", import.meta.url);
const requireFromMain = createRequire(mainUrl);
const outsideWork = requireFromMain("./scripts/outside-work.cjs");
const source = await fsp.readFile(mainUrl, "utf8");
const from = source.indexOf("// ---- work done outside Studio ----");
const to = source.indexOf("// ---- launch hold ----", from);
assert.ok(from >= 0 && to > from, "the outside-work block exists");
// Real git on a loaded desktop can outlast the product's 8 s budget; the
// tests are about what the scan concludes, so their git gets a minute.
const BLOCK = `${source.slice(from, to).replace("const OUTSIDE_GIT_TIMEOUT_MS = 8000;", "const OUTSIDE_GIT_TIMEOUT_MS = 60000;")}
globalThis.__outside = { outsideWorkScan, outsideWorkRefresh, outsideWorkCheck, outsideWorkKick, outsideWorkDecide, outsideWorkFacts, outsideWorkGreeting, outsideWorkGreeted, outsideWorkQuit, outsideWorkLeave,
  records: outsideWorkRecords, scanned: outsideWorkScanned, pending: outsideWorkPending, checking: () => outsideWorkChecking, saving: () => outsideWorkSaving };`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "outside-work-"));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const repo = path.join(root, "repo");
  const studio = path.join(root, "studio");
  const home = path.join(root, "home");
  await fsp.mkdir(path.join(repo, "src"), { recursive: true });
  await fsp.mkdir(studio, { recursive: true });
  await fsp.mkdir(home, { recursive: true });
  const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", timeout: 60000, windowsHide: true });
  git("init", "-q");
  git("config", "user.email", "owner@example.com");
  git("config", "user.name", "Owner");
  git("config", "commit.gpgsign", "false");
  await fsp.writeFile(path.join(repo, "src", "theme.js"), "export const theme = 'light';\n");
  await fsp.writeFile(path.join(repo, "README.md"), "# App\n");
  git("add", "-A");
  git("commit", "-q", "-m", "Seed the app");

  const project = { id: "project_fixture", name: "Fixture", path: repo };
  const board = {
    tasks: [
      { id: "t-theme", title: "Add a dark theme toggle", status: "open", files: ["src/theme.js"], createdAt: Date.now() - 60000 },
      { id: "t-docs", title: "Write the installer guide", status: "open", createdAt: Date.now() - 60000 },
      { id: "t-live", title: "Something a worker holds", status: "active", createdAt: Date.now() - 60000 },
    ],
  };
  const thread = [];
  const logs = [];
  const asks = [];
  const calls = [];
  const env = {
    model: { on: true, reply: null, prompts: [] },
    sessions: [],
  };
  const assistantState = { projectId: project.id, questions: [], closedAt: 0, ai: {} };
  const context = vm.createContext({
    console, Buffer, process, Promise, Date, JSON, Math, Number, String, Array, Object, Set, Map, RegExp, Error,
    setTimeout, clearTimeout,
    setInterval: () => ({ unref() {} }),
    require: requireFromMain,
    path, os: { homedir: () => home },
    existsSync: fs.existsSync, mkdirSync: fs.mkdirSync, writeFileSync: fs.writeFileSync, renameSync: fs.renameSync, rmSync: fs.rmSync,
    readFile: fsp.readFile, writeFile: fsp.writeFile, mkdir: fsp.mkdir, rename: fsp.rename, rm: fsp.rm, stat: fsp.stat, readdir: fsp.readdir,
    STUDIO_ROOT: studio, SMOKE: false, CAPTURE: false, CLI_MODE: false,
    OUTSIDE_WORK_PATH: path.join(studio, "data", "outside-work.json"),
    TASKS_PATH: "tasks", DATA_ONLY_CLIS: new Set(["claude"]),
    outsideWork,
    projects: {
      open: () => project, active: () => project, current: () => project,
      dataPath: (file) => path.join(studio, "data", "projects", project.id, path.basename(file)),
    },
    assistantState,
    startupChosen: true,
    assistantLoop: false,
    autopilot: { jobs: [] },
    window: null,
    getEyes: async () => ({ readJson: async () => structuredClone(board.tasks), listSessions: async () => structuredClone(env.sessions) }),
    mutateBoard: async (mutator) => {
      const next = structuredClone(board);
      const patch = mutator(next) ?? {};
      if (patch.ok === false) return patch;
      board.tasks = next.tasks;
      return { ...patch, tasks: structuredClone(board.tasks) };
    },
    logLine: (line) => logs.push(String(line)),
    assistantClip: (text, max) => String(text ?? "").slice(0, max),
    refreshAutopilotQueue: async () => {},
    emitAutopilot: () => {},
    assistantAppendReply: (text, via, intent, options) => { thread.push({ text, notice: options?.notice === true }); return { text }; },
    assistantEmit: () => {},
    saveAssistant: async () => {},
    assistantKeyPresent: async () => env.model.on,
    assistantFetch: async (system, user) => {
      env.model.prompts.push(JSON.parse(user));
      return env.model.reply ? { ok: true, text: env.model.reply(JSON.parse(user)) } : { ok: false, error: "no route" };
    },
    assistantQuestion: (payload) => {
      const question = { id: `q${asks.length + 1}`, status: "open", at: Date.now(), ...structuredClone(payload) };
      asks.push(question);
      assistantState.questions.push(question);
      return question;
    },
    assistantAskForWork: (reason) => calls.push(`ask:${reason}`),
    taskAction: async ({ taskId, status }) => {
      const task = board.tasks.find((row) => row.id === taskId);
      if (!task) return { ok: false, error: "gone" };
      Object.assign(task, { status, doneAt: Date.now(), verification: { state: "manual", reason: "Marked done by you" } });
      calls.push(`status:${taskId}:${status}`);
      return { ok: true };
    },
    dropTask: async ({ taskId }) => {
      const task = board.tasks.find((row) => row.id === taskId);
      Object.assign(task, { status: "archived", dropped: { by: "owner" } });
      calls.push(`drop:${taskId}`);
      return { ok: true };
    },
  });
  vm.runInContext(BLOCK, context);
  const host = context.__outside;
  // A scan kicks the check in the background; wait for both, and for saves.
  const settle = async () => {
    for (let round = 0; round < 50; round += 1) {
      await host.checking()?.promise;
      await host.saving();
      await sleep(5);
      if (!host.checking()) return;
    }
  };
  const saved = () => JSON.parse(fs.readFileSync(context.projects.dataPath("outside-work.json"), "utf8"));
  return { repo, home, git, project, board, thread, logs, asks, calls, env, assistantState, context, host, settle, saved };
}

test("a first open only takes a look; work done while Studio was away is reported, and every queued card is checked", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.host.outsideWorkScan("open"), null, "the first look is a baseline, not news");
  await f.settle();
  const baseline = f.saved().look;
  assert.match(baseline.head, /^[0-9a-f]{40}$/);
  assert.equal(baseline.branch, f.git("symbolic-ref", "--short", "HEAD").trim());
  assert.equal(f.thread.length, 0);
  assert.equal(f.host.pending.size, 0, "the check found nothing held and cleared the pending mark");

  // Studio closes; the owner commits the toggle by hand, leaves a note
  // uncommitted and runs a Claude Code session in the folder.
  await sleep(30);
  await fsp.writeFile(path.join(f.repo, "src", "theme.js"), "export const theme = 'light';\nexport const toggleDark = () => {};\n");
  f.git("commit", "-q", "-am", "Add the dark theme toggle");
  await fsp.mkdir(path.join(f.repo, "notes"), { recursive: true });
  await fsp.writeFile(path.join(f.repo, "notes", "todo.md"), "- installer\n");
  const transcripts = path.join(f.home, ".claude", "projects", f.repo.replace(/[^A-Za-z0-9]/g, "-"));
  await fsp.mkdir(transcripts, { recursive: true });
  await fsp.writeFile(path.join(transcripts, "abc.jsonl"), [
    JSON.stringify({ type: "summary", summary: "x" }),
    JSON.stringify({ type: "user", isMeta: true, message: { content: "<command-name>/clear</command-name>" } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "text", text: "Make the theme toggle remember the choice" }] } }),
  ].join("\n"));
  f.env.sessions = [
    { id: "ses_outside", title: "Explore the router", timeUpdated: Date.now() + 1000 },
    { id: "ses_old", title: "Before the look", timeUpdated: baseline.at - 60000 },
  ];

  f.env.model.reply = (body) => JSON.stringify({ cards: body.cards.map((row) => row.id === "t-theme"
    ? { id: row.id, verdict: "done", reason: "The toggle commit adds exactly this", commits: [body.outside.commits[0].commit] }
    : { id: row.id, verdict: "needed", reason: "Nothing outside touches the installer" }) });

  const rep = await f.host.outsideWorkScan("open");
  assert.ok(rep, "the second open reports");
  assert.equal(rep.commitCount, 1);
  assert.equal(rep.commits[0].subject, "Add the dark theme toggle");
  assert.deepEqual(rep.commits[0].files, ["src/theme.js"]);
  assert.deepEqual(rep.uncommitted.map((row) => row.path), ["notes/"]);
  assert.deepEqual(rep.sessions.map((row) => row.title).sort(), ["Explore the router", "Make the theme toggle remember the choice"]);
  assert.match(f.thread[0].text, /^While Studio was away/);
  assert.match(f.thread[0].text, /Checking the 2 queued cards/);
  assert.equal(f.thread[0].notice, true);
  await f.settle();

  const [theme, docs, live] = f.board.tasks;
  assert.equal(live.relevance, undefined, "a card a worker holds is not checked");
  assert.equal(theme.relevance.state, "ask");
  assert.equal(theme.relevance.verdict, "done");
  assert.equal(theme.relevance.by, "model");
  assert.equal(theme.relevance.commits[0].subject, "Add the dark theme toggle");
  assert.equal(theme.relevance.questionId, "q1");
  assert.match(theme.logs.at(-1).text, /looks already done outside Studio/);
  assert.equal(docs.relevance.state, "clear");
  assert.equal(docs.logs, undefined, "a plain needed verdict writes no log line");
  assert.equal(f.asks.length, 1);
  assert.equal(f.asks[0].title, '"Add a dark theme toggle" looks already done outside Studio');
  assert.match(f.thread.at(-1).text, /^Checked 2 queued cards against the work done outside Studio: 1 still needed, 1 looks already done\./);
  assert.ok(f.calls.some((call) => call.startsWith("ask:")), "the released card is dispatched");

  const prompt = f.env.model.prompts[0];
  assert.deepEqual(prompt.cards.map((row) => row.id), ["t-theme", "t-docs"]);
  assert.deepEqual(prompt.cards[0].files, ["src/theme.js"]);

  const facts = await f.host.outsideWorkFacts(f.board.tasks, Date.now());
  assert.equal(facts.commits[0].subject, "Add the dark theme toggle");
  assert.deepEqual(facts.cards.map((row) => [row.taskId, row.check, row.waitsForOwner ?? false]), [["t-theme", "done", true], ["t-docs", "needed", false]]);

  const greeting = await f.host.outsideWorkGreeting();
  assert.equal(greeting.part.phrase, "1 commit outside Studio");
  await f.host.outsideWorkGreeted(greeting);
  await f.host.saving();
  assert.equal(await f.host.outsideWorkGreeting(), null, "the digest greets a report once");
});

test("the owner's answers: build it anyway keeps the evidence, mark done closes it, and nobody else may answer", async (t) => {
  const f = await fixture(t);
  await f.host.outsideWorkScan("open");
  await f.settle();
  await sleep(30);
  await fsp.writeFile(path.join(f.repo, "src", "theme.js"), "export const theme = 'dark';\n");
  f.git("commit", "-q", "-am", "Add the dark theme toggle");
  f.env.model.reply = (body) => JSON.stringify({ cards: body.cards.map((row) => ({ id: row.id, verdict: row.id === "t-theme" ? "done" : "obsolete", reason: "covered" })) });
  await f.host.outsideWorkScan("open");
  await f.settle();
  assert.deepEqual(f.board.tasks.slice(0, 2).map((task) => task.relevance.state), ["ask", "ask"]);

  const refused = await f.host.outsideWorkDecide({ kind: "relevance", action: "mark_done", taskId: "t-theme" }, { origin: "delegate" });
  assert.equal(refused.ok, false);
  assert.equal(f.board.tasks[0].status, "open");

  const built = await f.host.outsideWorkDecide({ kind: "relevance", action: "retry", taskId: "t-theme" });
  assert.equal(built.ok, true);
  const theme = f.board.tasks[0];
  assert.equal(theme.relevance.state, "clear");
  assert.equal(theme.relevance.released.by, "owner");
  assert.equal(theme.relevance.commits[0].subject, "Add the dark theme toggle", "the evidence stays for the worker");
  assert.match(theme.logs.at(-1).text, /build it anyway/);
  assert.ok(outsideWork.briefLine(theme, Date.now()).includes("Add the dark theme toggle"));

  const done = await f.host.outsideWorkDecide({ kind: "relevance", action: "mark_done", taskId: "t-docs" });
  assert.equal(done.ok, true);
  const docs = f.board.tasks[1];
  assert.equal(docs.status, "done");
  assert.equal(docs.relevance.state, "closed");
  assert.match(docs.verification.reason, /done outside Studio/);
  const unknown = await f.host.outsideWorkDecide({ kind: "relevance", action: "explode", taskId: "t-docs" });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error, "That answer is not available.");
});

test("with no model the check matches files and commit subjects, and only a subject that says what the card says is asked about", async (t) => {
  const f = await fixture(t);
  f.env.model.on = false;
  f.board.tasks.push({ id: "t-router", title: "Speed up the router", status: "open", files: ["src/router.js"], createdAt: Date.now() - 60000 });
  await f.host.outsideWorkScan("open");
  await f.settle();
  await sleep(30);
  await fsp.writeFile(path.join(f.repo, "src", "theme.js"), "export const theme = 'dark';\n");
  await fsp.writeFile(path.join(f.repo, "src", "router.js"), "export const route = 1;\n");
  f.git("add", "-A");
  f.git("commit", "-q", "-m", "Add a dark theme toggle and a router stub");
  await f.host.outsideWorkScan("open");
  await f.settle();
  const [theme, docs, , router] = f.board.tasks;
  assert.equal(theme.relevance.state, "ask");
  assert.equal(theme.relevance.by, "local");
  assert.match(f.asks[0].title, /may already be done outside Studio/, "a local match is only a maybe");
  assert.equal(docs.relevance.state, "clear");
  assert.equal(router.relevance.state, "clear", "sharing a file is not being done");
  assert.deepEqual(router.relevance.files, ["src/router.js"]);
  assert.match(f.thread.at(-1).text, /no model answered/);
  assert.equal(f.env.model.prompts.length, 0);
});

test("the look follows the folder only while Studio watches, and a scan never reports a live run's edits", async (t) => {
  const f = await fixture(t);
  assert.equal(await f.host.outsideWorkRefresh("timer"), null, "no refresh before this process scanned the folder");
  await f.host.outsideWorkScan("open");
  await f.settle();

  // A Studio run commits; its settle refresh folds the commit into the look.
  await sleep(30);
  await fsp.writeFile(path.join(f.repo, "README.md"), "# App\n\nBuilt by a worker.\n");
  f.git("commit", "-q", "-am", "Worker: document the app");
  const refreshed = await f.host.outsideWorkRefresh("run");
  assert.equal(refreshed.head, f.git("rev-parse", "HEAD").trim());
  await f.host.saving();
  assert.equal(f.saved().look.head, refreshed.head);
  assert.equal(await f.host.outsideWorkScan("open"), null, "Studio's own commit is not outside work");

  // The window comes back within two minutes of a scan: not scanned again.
  assert.equal(await f.host.outsideWorkScan("welcome"), null);
  // A worker still editing: a welcome scan waits rather than report its edits.
  f.host.scanned.set(f.project.id, 0);
  f.context.autopilot.jobs = [{ finished: false }];
  await fsp.writeFile(path.join(f.repo, "src", "theme.js"), "// a worker mid-edit\n");
  assert.equal(await f.host.outsideWorkScan("welcome"), null);
  assert.equal(f.thread.length, 0);
});

test("quitting writes the HEAD and the time synchronously", async (t) => {
  const f = await fixture(t);
  await f.host.outsideWorkScan("open");
  await f.settle();
  await sleep(30);
  await fsp.writeFile(path.join(f.repo, "README.md"), "# App 2\n");
  f.git("commit", "-q", "-am", "Last worker commit before quit");
  const before = Date.now();
  f.host.outsideWorkQuit();
  const look = f.saved().look;
  assert.equal(look.head, f.git("rev-parse", "HEAD").trim());
  assert.ok(look.at >= before);
});

test("a folder that is not a git checkout still reports outside agent sessions, and sessions alone hold no card", async (t) => {
  const f = await fixture(t);
  await fsp.rm(path.join(f.repo, ".git"), { recursive: true, force: true });
  await f.host.outsideWorkScan("open");
  await f.settle();
  f.env.sessions = [{ id: "ses_new", title: "Sketch the landing page", timeUpdated: Date.now() + 1000 }];
  f.env.model.on = false;
  const rep = await f.host.outsideWorkScan("open");
  assert.ok(rep);
  assert.equal(rep.commitCount, 0);
  assert.deepEqual(rep.sessions.map((row) => row.title), ["Sketch the landing page"]);
  assert.match(rep.headline, /1 outside agent session/);
  await f.settle();
  assert.ok(f.board.tasks.every((task) => task.relevance === undefined), "nothing changed in the code, so nothing is held or checked");
  assert.doesNotMatch(f.thread.at(-1).text, /Checking/);
});

test("a Codex rollout in the folder is an outside session; one in another folder, or older than the look, is not", async (t) => {
  const f = await fixture(t);
  await f.host.outsideWorkScan("open");
  await f.settle();
  const look = f.saved().look;
  await sleep(30);
  const day = new Date();
  const dir = path.join(f.home, ".codex", "sessions", String(day.getFullYear()), String(day.getMonth() + 1).padStart(2, "0"), String(day.getDate()).padStart(2, "0"));
  await fsp.mkdir(dir, { recursive: true });
  const rollout = (id, cwd, text) => [
    JSON.stringify({ type: "session_meta", payload: { id, cwd, base_instructions: { text: "x".repeat(70000) } } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "<environment_context/>" }, { type: "input_text", text }] } }),
  ].join("\n");
  await fsp.writeFile(path.join(dir, "rollout-here.jsonl"), rollout("c-here", path.join(f.repo, "src"), "Tune the theme contrast"));
  await fsp.writeFile(path.join(dir, "rollout-elsewhere.jsonl"), rollout("c-else", path.join(f.home, "other"), "Other project"));
  await fsp.writeFile(path.join(dir, "rollout-old.jsonl"), rollout("c-old", f.repo, "Before the look"));
  const old = new Date(look.at - 60000);
  await fsp.utimes(path.join(dir, "rollout-old.jsonl"), old, old);
  f.env.model.on = false;
  const rep = await f.host.outsideWorkScan("open");
  assert.deepEqual(rep.sessions.map((row) => [row.tool, row.title]), [["codex", "Tune the theme contrast"]], "a 70 KB first line is still read whole");
  assert.ok(rep.lines.includes("Codex session: Tune the theme contrast"));
});
