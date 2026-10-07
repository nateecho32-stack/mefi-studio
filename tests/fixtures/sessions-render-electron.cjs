"use strict";

// Build's desktop inside the 0.5 frame (renderer/sessions.js), in a real Chromium: a copied booklet in the 0.5 layout,
// the real shell (renderer/shell.js: its list, main and inspector regions, its drawers below
// 900 CSS px, its bars) and a synthetic
// bridge that answers with a board that has a task in every stage, a run in its own worktree, an open question, a finished
// attempt with changes (Accept, Revert and its Undo really change what the bridge answers next), pictures a brief and a
// message carry, and the before and after shots of an attempt. It checks what the DOM tests cannot: the list, the thread
// and the inspector fit six window sizes (the five of the layout contract and a short, wide one), no scroller reserves width for a bar, nothing is under 12 px, pictures and shots
// are whole (never cropped) and open in the lightbox, and the keys work.
// Screenshots are kept when the test is given a capture folder. No application main process or live state is loaded;
// network, permissions and child processes are blocked.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_SESSIONS_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated Sessions fixture directory is required");
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [], steps: [] };
app.setName("Sessions Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
}
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("force-prefers-reduced-motion", "reduce");
const childProcess = require("node:child_process");
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = () => { report.processAttempts.push(name); throw new Error("Child execution is disabled in this fixture"); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let finished = false;
function finish(error) {
  if (finished) return; finished = true;
  if (error) { report.failure = error.stack || String(error); console.error(report.failure); }
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  app.exit(error ? 1 : 0);
}
process.on("uncaughtException", finish); process.on("unhandledRejection", finish);

// ---- the board -----------------------------------------------------------------------------------------------------------------
const projectId = "project_fixture";
const now = Date.now();
const mins = (count) => now - count * 60000;
const hours = (count) => now - count * 3600000;
const PIC_WIDE = "img_a1b2c3d4e5f60718293a4b5c", PIC_TALL = "img_0f1e2d3c4b5a69788796a5b4";
const task = (id, title, extra = {}) => ({ id, projectId, title, prompt: `${title}.`, status: "open", createdAt: hours(30), updatedAt: hours(30), ...extra });
const seed = {
  projectId, root,
  tasks: [
    task("task_ask", "Add an empty state to the notes list", { status: "active", runId: "run_ask_1", updatedAt: mins(4), createdAt: mins(52), prompt: `Show a friendly empty state when there are no notes yet.\n\nThe owner attached empty-state.png at ${root}/attachments/${PIC_WIDE}.png\nThe owner attached toolbar.png at ${root}/attachments/${PIC_TALL}.png\n\nGoal:\nAn empty notes list says what to do next.\n\nDone when:\n- The list shows "No notes yet" with a Create note button\n- Existing tests still pass\n\nKeep unchanged:\nThe toolbar.`, acceptance: ["The list shows \"No notes yet\" with a Create note button", "Existing tests still pass"], lastAttempt: { runId: "run_ask_1", at: mins(46), route: "OpenCode" } }),
    task("task_failed", "Speed up the first paint on the map", { updatedAt: hours(3), prompt: "The map takes too long to show its first frame.", verification: { state: "failed", reason: "The first-paint budget failed: 2.4 s against 1.5 s." }, verificationRun: { state: "failed", key: "run_fail_1", results: [{ name: "first paint under 1.5 s", ok: false, detail: "2.4 s" }, { name: "unit tests", ok: true }] }, lastAttempt: { runId: "run_fail_1", at: hours(3), route: "Codex" } }),
    task("task_run", "Search notes by tag", { status: "active", runId: "run_run_1", updatedAt: mins(1), createdAt: mins(35), prompt: "Let me filter the notes list by tag.", runProgress: { outputTail: ["reading src/search/tags.ts", "writing parseTags()", "running npm test"] }, lastAttempt: { runId: "run_run_1", at: mins(31), route: "Claude Code" } }),
    task("task_run2", "Keyboard shortcut for a new note", { status: "active", runId: "run_run2_1", updatedAt: mins(2), createdAt: mins(20), prompt: "Press n anywhere to start a note.", lastAttempt: { runId: "run_run2_1", at: mins(19), route: "OpenCode" } }),
    task("task_review", "Export notes as Markdown", { status: "awaiting_verification", updatedAt: mins(12), createdAt: hours(2), prompt: "Add an Export button to the toolbar. It should write one .md file per note, with the tags as front matter.", acceptance: ["One .md file per note", "Tags become front matter"], verificationRun: { state: "running", key: "run_done_1", results: [{ name: "typecheck", ok: true }, { name: "export test", ok: true }, { name: "lint", ok: null }] }, lastAttempt: { runId: "run_done_1", at: mins(40), route: "Claude Code" } }),
    task("task_queued", "Dark mode for the settings page", { updatedAt: hours(2), prompt: "Give the settings page a dark theme." }),
    task("task_queued2", "Pin favourite notes", { updatedAt: hours(4), prompt: "Let me pin notes to the top of the list." }),
    task("task_done", "Rename the export button", { status: "done", updatedAt: hours(26), doneAt: hours(26), prompt: "Rename Export to Export as Markdown.", verification: { state: "verified", reason: "The button reads Export as Markdown and the test that looks for it passes." }, lastAttempt: { runId: "run_old_1", at: hours(27), route: "OpenCode" } }),
    task("task_done2", "Fix the login redirect loop", { status: "done", updatedAt: hours(50), doneAt: hours(50), prompt: "Logging in sends me round in circles.", verification: { state: "manual" } }),
    task("task_done3", "Trim the changelog", { status: "done", updatedAt: hours(120), doneAt: hours(120), prompt: "Shorten old entries." }),
  ],
  ideas: [{ id: "idea_1", title: "Share a note as a link", detail: "A read-only link for a note", source: "Mefi", at: hours(9), status: "open" }, { id: "idea_2", title: "Tag suggestions", detail: "", source: "", at: hours(80), status: "open" }],
  questions: [{ id: "q_1", status: "open", title: "Should the empty state also appear when a search has no matches?", detail: "The list can be empty for two reasons: no notes at all, or a search that found none.", at: mins(4), context: { taskId: "task_ask", suggestion: { optionId: "yes", reason: "it is the same component and the same words" }, evidence: ["src/notes/NotesList.tsx renders the list", "search results reuse it"] }, options: [{ id: "only", label: "Only when there are no notes" }, { id: "yes", label: "Yes, reuse it", recommended: true }] }],
  messages: [
    { id: "m_ask", role: "user", text: 'About the task "Export notes as Markdown" (task_review): Does this match the toolbar in my screenshot?', at: mins(30), projectId, images: [{ id: PIC_TALL, name: "toolbar.png" }] },
    { id: "m_reply", role: "assistant", text: "The Export button sits in the same place as the one in your screenshot, to the right of Share.", at: mins(29), projectId },
  ],
  decisions: [{ id: "dec_1", taskId: "task_done", at: hours(27), label: "Keep the old name as an alias", reason: "existing links keep working", choice: "alias" }],
  changes: { accepted: false, reverted: false, receipt: null },
  history: [{ id: "rev_1", kind: "Edited brief", at: hours(1), note: "", snapshot: { prompt: "Add an Export button to the toolbar." } }, { id: "rev_2", kind: "First brief", at: hours(2), note: "", snapshot: { prompt: "Export notes." } }],
};
const base = { kind: "dev", detached: false, locked: false, lockedReason: "", missing: false, dirty: 0, ahead: 0, behind: 0, pushed: true, upstreamName: "origin/main", last: null, task: null, busy: false };
seed.worktrees = { ok: true, repo: true, root: "/work/mefi-studio", main: "main", upstream: "origin/main", hasUpstream: true, projectId, enabled: { on: false, forced: false }, builders: true, summary: { total: 2, atRisk: 1, toLand: 0, safeToRemove: 0, missing: 0 }, headline: "2 worktrees.", rows: [
  { ...base, kind: "primary", path: "/work/mefi-studio", name: "mefi-studio", branch: "main", head: "9f8e7d6", sha: "9f8e7d6".padEnd(40, "0"), state: "primary", action: "" },
  { ...base, kind: "run", path: "/work/mefi-studio/.mefi/worktrees/run_run_1", name: "run_run_1", branch: "mefi/tag-search", head: "cc22dd3", sha: "cc22dd3".padEnd(40, "0"), ahead: 2, pushed: false, busy: true, state: "unpushed", action: "2 commits only on this PC.", task: { taskId: "task_run", title: "Search notes by tag", at: 1 } },
] };

// ---- the bridge: runs in the page, before any script there -------------------------------------------------------------------
function bridge(seedData) {
  const { contextBridge } = require("electron");
  const calls = [];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const data = clone(seedData);
  const { projectId: pid } = data;
  const t = Date.now();
  const hoursAgo = (n) => t - n * 3600000;
  // A picture drawn here, so the page gets real pixels: a wide screenshot, a tall one, and a before / after pair of the preview.
  const draw = (width, height, paint) => {
    try {
      const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
      const g = canvas.getContext("2d"); paint(g, width, height);
      return canvas.toDataURL("image/png");
    } catch { return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=="; }
  };
  const app = (g, w, h, empty) => {
    g.fillStyle = "#101a22"; g.fillRect(0, 0, w, h);
    g.fillStyle = "#1c2b36"; g.fillRect(0, 0, w, 64); g.fillStyle = "#8fe3cf"; g.font = "bold 28px sans-serif"; g.fillText("Notes", 24, 42);
    g.fillStyle = "#2a3d4b"; g.fillRect(w - 220, 14, 90, 36); g.fillRect(w - 120, 14, 90, 36);
    g.fillStyle = "#e7f5ee"; g.font = "22px sans-serif";
    if (empty) { g.fillText("No notes yet.", w / 2 - 70, h / 2); g.fillStyle = "#8fe3cf"; g.fillRect(w / 2 - 70, h / 2 + 24, 140, 40); g.fillStyle = "#04130e"; g.fillText("Create note", w / 2 - 54, h / 2 + 52); }
    else { for (let i = 0; i < 5; i += 1) { g.fillStyle = "#1c2b36"; g.fillRect(24, 90 + i * 70, w - 48, 56); } }
  };
  const pictures = {
    [data.ids.wide]: { name: "empty-state.png", mime: "image/png", width: 960, height: 300, dataUrl: () => draw(960, 300, (g, w, h) => { g.fillStyle = "#223"; g.fillRect(0, 0, w, h); for (let i = 0; i < 12; i += 1) { g.fillStyle = i % 2 ? "#e85d75" : "#5de8b5"; g.fillRect(i * 80, 0, 40, h); } g.fillStyle = "#fff"; g.font = "bold 34px sans-serif"; g.fillText("WIDE 960 x 300", 330, 160); }) },
    [data.ids.tall]: { name: "toolbar.png", mime: "image/png", width: 360, height: 720, dataUrl: () => draw(360, 720, (g, w, h) => { g.fillStyle = "#322"; g.fillRect(0, 0, w, h); for (let i = 0; i < 12; i += 1) { g.fillStyle = i % 2 ? "#e8b55d" : "#5d9be8"; g.fillRect(0, i * 60, w, 30); } g.fillStyle = "#fff"; g.font = "bold 30px sans-serif"; g.fillText("TALL 360 x 720", 60, 370); }) },
  };
  const live = (status) => data.running = status;
  data.running = [
    { id: "run_run_1", runId: "run_run_1", taskId: "task_run", title: "Search notes by tag", startedAt: t - 31 * 60000, phase: "building", route: "Claude Code", currentStep: "Writing parseTags()", progress: 0.6 },
    { id: "run_run2_1", runId: "run_run2_1", taskId: "task_run2", title: "Keyboard shortcut for a new note", startedAt: t - 19 * 60000, phase: "building", route: "OpenCode", currentStep: "Reading the shortcut map", progress: 0.3 },
    { id: "run_ask_1", runId: "run_ask_1", taskId: "task_ask", title: "Add an empty state to the notes list", startedAt: t - 46 * 60000, phase: "building", route: "OpenCode", currentStep: "Waiting for your answer", progress: 0.5 },
  ];
  void live;
  const files = () => [
    { path: "src/export/markdown.ts", dir: "src/export/", name: "markdown.ts", oldPath: null, status: "added", additions: 96, deletions: 0, binary: false, kind: "file", state: data.changes.reverted ? "reverted" : "can-revert" },
    { path: "src/notes/Toolbar.tsx", dir: "src/notes/", name: "Toolbar.tsx", oldPath: null, status: "modified", additions: 31, deletions: 4, binary: false, kind: "file", state: data.changes.reverted ? "reverted" : "can-revert" },
    { path: "src/export/names.ts", dir: "src/export/", name: "names.ts", oldPath: null, status: "added", additions: 52, deletions: 0, binary: false, kind: "file", state: data.changes.reverted ? "reverted" : "can-revert" },
    { path: "tests/export.test.ts", dir: "tests/", name: "export.test.ts", oldPath: null, status: "added", additions: 33, deletions: 14, binary: false, kind: "file", state: data.changes.reverted ? "reverted" : "can-revert" },
  ];
  // What the host's own list of what waits on you says (scripts/companion.cjs queue(), assistantState.needsYou, the list the taskbar
  // count is read from): every open question, and the task whose check failed, parked until someone decides. The backlog lists that
  // task as blocked with its reason, as the scheduler does.
  const failedOpen = () => data.tasks.find((row) => row.id === "task_failed" && row.status === "open" && row.verification?.state === "failed") ?? null;
  const digest = () => {
    const items = data.questions.filter((question) => question.status === "open").map((question) => ({ id: question.id, kind: "question", taskId: question.context?.taskId ?? null, title: question.title, at: question.at, actions: (question.options || []).map((option) => ({ id: option.id, label: option.label })) }));
    const failed = failedOpen();
    if (failed) items.push({ id: "parked:task_failed", kind: "parked", taskId: failed.id, title: failed.title, at: failed.updatedAt });
    return { items, counts: { total: items.length } };
  };
  const handlers = {
    projectsList: () => ({ ok: true, activeId: pid, projects: [{ id: pid, name: "Notes app", path: data.root }] }),
    tasksList: () => ({ ok: true, projectId: pid, tasks: data.tasks }),
    ideasList: () => ({ ok: true, ideas: data.ideas }),
    planningList: () => ({ ok: true, projectId: pid, plans: [] }),
    assistantState: () => ({ ok: true, state: { projectId: pid, status: "running", agents: [], messages: data.messages, prefs: { proactive: true, parallel: 8, aiParallel: 4, memoryAlign: true, loopGuard: true, loopGuardApply: true, compactHistory: true, keepAwake: true, background: true }, work: [], questions: data.questions, needsYou: digest() } }),
    assistantStatus: () => ({ ok: true, status: { projectId: pid, enabled: true, execute: true, autoBuild: true, minutes: 5, parallel: 3, adaptiveParallel: true, mode: "swarm", running: data.running, history: [] } }),
    backlogStatus: () => { const failed = failedOpen(); return { ok: true, projectId: pid, paused: false, draining: false, counts: {}, taskStates: failed ? [{ id: failed.id, stage: "blocked" }] : [], next: [], approval: [], blocked: failed ? [{ id: failed.id, kind: "task", title: failed.title, blockedBy: null, reason: failed.verification.reason, canRetry: true }] : [] }; },
    tasksAttempts: ({ taskId }) => {
      const attempts = {
        task_ask: [{ runId: "run_ask_1", startedAt: t - 46 * 60000, via: "OpenCode", fallbacks: [], finishedAt: null, ok: null, stopped: false, limitMinutes: 25, seconds: null, result: "", tail: [], release: null, outcome: "unrecorded" }],
        task_run: [{ runId: "run_run_1", startedAt: t - 31 * 60000, via: "Claude Code", fallbacks: [{ at: t - 30 * 60000, reason: "the first worker was busy" }], finishedAt: null, ok: null, stopped: false, limitMinutes: 25, seconds: null, result: "", tail: [], release: null, outcome: "unrecorded" }],
        task_review: [{ runId: "run_done_1", startedAt: t - 40 * 60000, via: "Claude Code", fallbacks: [], finishedAt: t - 14 * 60000, ok: true, stopped: false, stoppedAtLimit: false, limitMinutes: 25, seconds: 1560, result: "Added the Export button to the toolbar and wrote one Markdown file per note, with the tags as front matter.", tail: ["$ npm run check", "ok: 0 errors", "wrote 4 files"], release: null, outcome: "finished-ok" }],
        task_failed: [{ runId: "run_fail_1", startedAt: hoursAgo(3.4), via: "Codex", fallbacks: [], finishedAt: hoursAgo(3.1), ok: false, stopped: false, limitMinutes: 25, seconds: 1100, result: "", error: "The first-paint budget failed.", tail: ["first paint 2.4 s"], release: null, outcome: "failed" }],
      };
      return { ok: true, taskId, attempts: attempts[taskId] || [] };
    },
    tasksChanges: ({ taskId }) => {
      if (taskId !== "task_review") return { ok: true, available: true, taskId, attempt: null, state: "none", files: [], totals: { files: 0, additions: 0, deletions: 0 }, attempts: [] };
      return { ok: true, available: true, taskId, projectId: pid, attempt: 1, runId: "run_done_1", state: "ended", attempts: [{ n: 1, runId: "run_done_1", startedAt: t - 40 * 60000, endedAt: t - 14 * 60000, ended: true, selected: true, reverts: data.changes.reverted ? [{ receipt: data.changes.receipt, at: t }] : [], accepted: data.changes.accepted, running: false }], files: files(), totals: { files: 4, additions: 212, deletions: 18, binary: 0 }, more: 0, skipped: { count: 0, files: [], sentence: "" }, overlap: [], worktree: false, accepted: data.changes.accepted, running: false, waiting: false, canAccept: !data.changes.reverted, canRevert: !data.changes.reverted };
    },
    tasksDiff: ({ path: file }) => ({ ok: true, path: file, status: "added", additions: 4, deletions: 0, binary: false, truncated: false, lines: [{ k: "h", t: `@@ ${file} @@` }, { k: "+", t: "export function toMarkdown(note) {", b: 1 }, { k: "+", t: "  return note.body;", b: 2 }, { k: "+", t: "}", b: 3 }] }),
    tasksAccept: ({ accepted }) => { data.changes.accepted = accepted !== false; return { ok: true, accepted: data.changes.accepted, attempt: 1 }; },
    tasksRevert: (payload) => {
      if (payload.undo) { data.changes.reverted = false; data.changes.receipt = null; return { ok: true, undone: true, restored: 4 }; }
      data.changes.reverted = true; data.changes.receipt = "R20260930"; data.changes.accepted = false;
      return { ok: true, reverted: 4, files: 4, already: 0, refused: [], receipt: data.changes.receipt, scope: "attempt", reopened: true };
    },
    tasksChecks: ({ taskId }) => ({ ok: true, available: true, taskId, projectId: pid, attempt: 1, at: t - 60000, results: [{ id: "typecheck", label: "Typecheck", status: "ok", detail: "0 errors", ms: 900 }, { id: "lint", label: "Lint", status: "warn", detail: "2 warnings", ms: 400 }], detected: [{ id: "typecheck", label: "Typecheck", auto: true, writes: false }, { id: "lint", label: "Lint", auto: true, writes: false }], none: false, build: false }),
    tasksEvidence: ({ taskId }) => (["task_review", "task_ask", "task_done"].includes(taskId)
      ? { ok: true, taskId, projectId: pid, attempt: 1, runId: "run_done_1", enabled: true, forced: false, shots: [{ phase: "before", at: 1, bytes: 10, width: 1280, height: 800, dataUrl: draw(1280, 800, (g, w, h) => app(g, w, h, false)) }, { phase: "after", at: 2, bytes: 10, width: 1280, height: 800, dataUrl: draw(1280, 800, (g, w, h) => app(g, w, h, true)) }], notes: { before: "Captured when the task started.", after: "Captured when the task finished." }, privacy: "Screenshots stay on this PC. They can show secrets, so they are never added to a problem report." }
      : { ok: true, taskId, projectId: pid, attempt: null, enabled: true, forced: false, shots: [], notes: {}, privacy: "" }),
    reviewPrefs: () => ({ ok: true, prefs: { snapshots: true, advisory: true, advisoryBuild: false, shots: true }, saved: { snapshots: true, advisory: true, advisoryBuild: false, shots: true }, forced: { snapshots: false, advisory: false, shots: false } }),
    assistantImageRead: ({ id }) => { const p = pictures[id]; if (!p) return { ok: false, error: "That picture is no longer saved." }; const dataUrl = p.dataUrl(); return { ok: true, id, name: p.name, mime: p.mime, bytes: dataUrl.length, width: p.width, height: p.height, dataUrl }; },
    assistantImage: () => ({ ok: true, off: false }),
    assistantAnswer: ({ id, optionId, text }) => { data.questions = data.questions.filter((q) => q.id !== id); return { ok: true, id, optionId, text }; },
    assistantMessage: (text) => { data.messages.push({ id: `m_${data.messages.length}`, role: "user", text, at: Date.now(), projectId: pid }, { id: `m_${data.messages.length + 1}`, role: "assistant", text: "Yes: that matches.", at: Date.now() + 1, projectId: pid }); return { ok: true, state: { messages: data.messages } }; },
    tasksSave: (list) => { for (const row of Array.isArray(list) ? list : [list]) { const at = data.tasks.findIndex((item) => item.id === row.id); if (at >= 0) data.tasks[at] = row; } return { ok: true }; },
    tasksCreate: (payload) => { data.tasks.push({ id: `task_new_${data.tasks.length}`, projectId: pid, title: payload.title, prompt: payload.prompt, status: "open", createdAt: Date.now(), updatedAt: Date.now() }); return { ok: true }; },
    tasksAction: (payload) => {
      const row = data.tasks.find((item) => item.id === payload.taskId);
      if (row && payload.action === "rename") row.title = payload.title;
      if (row && payload.action === "status" && payload.status === "done") { row.status = "done"; row.doneAt = Date.now(); row.verification = { state: "manual" }; }
      if (row && payload.action === "stop") { data.running = data.running.filter((job) => job.taskId !== payload.taskId); row.status = "open"; row.runId = null; }
      return { ok: true };
    },
    tasksDelete: ({ taskId }) => { const row = data.tasks.find((item) => item.id === taskId); data.tasks = data.tasks.filter((item) => item.id !== taskId); (data.deleted ||= []).push(row); return { ok: true, trashed: [{ kind: "task", id: taskId }] }; },
    tasksUndelete: ({ taskId }) => { const at = (data.deleted || []).findIndex((item) => item.id === taskId); if (at >= 0) data.tasks.push(...data.deleted.splice(at, 1)); return { ok: true }; },
    autonomyState: () => ({ ok: true, projectId: pid, level: "auto", elevated: {}, categories: [], decisions: data.decisions }),
    autonomyUndo: ({ id }) => { data.decisions = data.decisions.filter((row) => row.id !== id); return { ok: true }; },
    tasksHistory: () => ({ ok: true, entries: data.history, hasMore: false }),
    tasksRestore: () => ({ ok: true }),
    taskMetrics: ({ taskId }) => ({ ok: true, taskId, attempt: { live: taskId === "task_run", startedAt: t - 31 * 60000, seconds: 1560, stoppedAtLimit: false, route: { label: "Claude Code" }, tokens: { state: "not-reported" }, cost: { state: "not-reported" } }, task: { attempts: 2, seconds: 2900, secondsUnknown: false, subtasks: 0, tokens: { state: "not-reported" }, cost: { state: "not-reported" } }, cap: { enabled: true, minutes: 25, effectiveMinutes: 25, min: 5, step: 5, ceilingMinutes: 60, raised: false }, coverage: { reasons: [] } }),
    tasksCap: () => ({ ok: true }),
    projectPreviewStatus: () => ({ ok: true, projectId: pid, phase: "ready", available: true, canStop: true, owned: true, url: "http://localhost:5173/" }),
    projectPreviewStart: () => ({ ok: true, projectId: pid, phase: "ready", available: true, canStop: true, owned: true, url: "http://localhost:5173/" }),
    projectPreviewOpen: () => ({ ok: true, projectId: pid, phase: "ready", available: true, canStop: true, owned: true, url: "http://localhost:5173/" }),
    projectPreviewStop: () => ({ ok: true, projectId: pid, phase: "stopped", available: true, canStop: false, owned: true }),
    workWhere: () => ({ ok: true, projectId: pid, repo: true, branch: "main", head: "996db71", dirty: 3, worktrees: { on: false, forced: false } }),
    // The Git chip's model, as scripts/git-link.cjs words it: three changed files on main.
    gitState: () => ({ ok: true, model: { id: "uncommitted", label: "3 changes", short: "3", tone: "info", glyph: "uncommitted", sentence: "3 files have changed since your last commit.", projectId: pid, details: [], branch: "main", repo: "owner/notes", checkedAt: Date.now() - 120000, counts: { ahead: 0, behind: 0, dirty: 3 }, primary: { id: "save-and-push", label: "Save and push 3" }, secondary: { id: "save", label: "Save only" } } }),
    workWorktrees: (on) => ({ ok: true, worktrees: { on: Boolean(on), forced: false } }),
    worktreesList: () => data.worktrees,
    getAiRouting: () => ({ ok: true, provider: "auto", executorCli: "opencode", executorTier: "auto", executorTierDefaults: {}, executorModels: { opencode: "zai/glm-5.3" }, autoProviders: ["zai", "opencode"], hasZen: true }),
    setAiRouting: () => ({ ok: true }),
    cliStatus: () => [{ id: "opencode", installed: true }, { id: "claude", installed: true }],
    prefsGet: () => ({ ok: true, prefs: { commandHome: false, autoReference: true, useReference: true, useTree: true, useWeb: false, composerPicker: true } }),
    agentsSkills: () => ({ ok: true, skills: [{ name: "bug-triage", description: "Reproduce a bug" }] }),
    projectFiles: () => ({ ok: true, files: [{ name: "Toolbar.tsx", path: "src/notes/Toolbar.tsx", dir: "src/notes" }] }),
    shellReveal: () => ({ ok: true }),
    readCatalog: () => data.catalog,
    eyesState: () => ({ ok: true, sessions: [], todos: [], changes: [], pngs: [] }), eyesCheckpointsRead: () => ({ ok: true, checkpoints: {} }), eyesRequestsRead: () => ({ ok: true, requests: [] }), eyesBriefingRead: () => ({ ok: true, briefing: null }), eyesCollisions: () => ({ ok: true, collisions: [], presence: [] }), speedMeasurements: () => ({ ok: true, measurements: {} }),
    jevStatus: () => ({ enabled: true, route: "zen", routes: { vercel: false, typesafe: false, zen: true, openrouter: false } }),
    agentsState: () => ({ ok: true, projectId: pid, revision: 0, inherited: true, name: "Studio defaults", configuration: {}, defaults: {}, presets: [], skills: [], mcpTools: [], routing: {}, seats: {}, choices: {} }),
    cliSetupStatus: () => ({ ok: true, selected: "auto", clis: [] }), firstRunStatus: () => ({ ok: true, firstRun: null }),
    machineGet: () => ({ ok: true, machine: { autoKill: true, idleSeconds: 240, maxAgeMinutes: 20, maxMemMB: 1500 } }), updateStatus: () => ({ ok: true, status: { auto: true } }),
    companionState: () => ({ ok: true, projectId: pid, projectName: "Notes app", state: "idle", look: "wisp", scope: "project", roaming: false, pinned: true, bubbles: false, growth: false, queue: { items: [], counts: { total: 0 } }, learning: {}, preferences: [], activity: [] }),
    learningState: () => ({ ok: true, projectId: pid, decisions: { enabled: true, scope: "blend" }, models: "blend", profiles: {} }),
    openrouterModels: () => ({ ok: true, models: [] }), agentModels: () => ({ ok: true, models: [] }),
    workStats: () => ({ ok: true, projectId: pid, totals: { tasks: 12, runs: 31, tokens: 1234567, activeDays: 9, verified: 7 }, peakHour: 14, days: [], models: [], store: { ok: true, error: null } }),
    // The status bar's right-hand facts: a plan's two windows, what today's recorded calls cost (the usage tracker's own reads).
    usageTracker: () => ({ ok: true, today: { calls: 14, usage: { costUsd: { known: 1.92, knownRecords: 14 } } } }),
    opencodeCredits: () => ({ ok: true, fetchedAt: Date.now(), usage: { rolling: { percent: 20, resetsAt: new Date(Date.now() + 3 * 3600000).toISOString() }, weekly: { percent: 50, resetsAt: new Date(Date.now() + 4 * 86400000).toISOString() } } }),
    usageAccounts: () => ({ ok: true, accounts: [] }),
  };
  const api = {};
  for (const [name, handler] of Object.entries(handlers)) {
    api[name] = async (...args) => { calls.push({ name, args: clone(args) }); return clone(handler(args[0] ?? {}, args)); };
  }
  const callbacks = {};
  for (const name of ["onTasks", "onProjects", "onAssistant", "onAssistantStatus", "onProjectPreview", "onSettingsChanged", "onStudioLog", "onAutoSetup", "onReviewChanged", "onMachineStatus"]) api[name] = (callback) => { (callbacks[name] ||= []).push(callback); return () => {}; };
  contextBridge.exposeInMainWorld("mefiStudio", api);
  contextBridge.exposeInMainWorld("sessionsFixture", {
    calls: () => calls, clear: () => { calls.length = 0; }, state: () => clone({ changes: data.changes, tasks: data.tasks.map((row) => ({ id: row.id, title: row.title, status: row.status })), questions: data.questions.length, decisions: data.decisions.length, messages: data.messages.length }),
    push: (name, payload) => { for (const callback of callbacks[name] || []) callback(payload); },
  });
}

// ---- what the page looks like right now, in real pixels ---------------------------------------------------------------------------------
const measure = `
  const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: Math.round(r.left * 10) / 10, y: Math.round(r.top * 10) / 10, r: Math.round(r.right * 10) / 10, b: Math.round(r.bottom * 10) / 10, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 }; };
  const visible = (node) => { const r = node.getBoundingClientRect(); const s = getComputedStyle(node); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const mine = [...document.querySelectorAll('.sx-panel, .sx-panel *, .sx-lightbox, .sx-lightbox *')].filter((node) => node.closest('[hidden]') === null || node.hidden === false && visible(node));
  const leafText = mine.filter((node) => visible(node) && [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim()));
  const small = leafText.filter((node) => parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => (node.id || node.className || node.tagName) + ':' + getComputedStyle(node).fontSize + ':' + node.textContent.trim().slice(0, 24));
  const scrollers = mine.filter((node) => { const s = getComputedStyle(node); return /(auto|scroll)/.test(s.overflowY) || /(auto|scroll)/.test(s.overflowX); })
    .map((node) => { const s = getComputedStyle(node); return { id: node.id, cls: String(node.className).slice(0, 40), reserved: Math.round((node.offsetWidth - node.clientWidth - parseFloat(s.borderLeftWidth) - parseFloat(s.borderRightWidth)) * 10) / 10, reservedY: Math.round((node.offsetHeight - node.clientHeight - parseFloat(s.borderTopWidth) - parseFloat(s.borderBottomWidth)) * 10) / 10 }; });
  const wide = [...document.querySelectorAll('.sx-panel')].filter(visible).filter((node) => node.scrollWidth > node.clientWidth + 1).map((node) => node.id + ':' + node.scrollWidth + '>' + node.clientWidth);
  const spill = [...document.querySelectorAll('.sx-panel *')].filter((node) => visible(node) && node.closest('.sx-groups, .sx-scroll, .sx-ibody, .sx-dock, .sx-menu, .sx-said pre') === null).map((node) => ({ node, r: node.getBoundingClientRect(), panel: node.closest('.sx-panel').getBoundingClientRect() })).filter(({ r, panel }) => r.right > panel.right + 1 || r.left < panel.left - 1).map(({ node }) => (node.id || node.className || node.tagName) + '');
  return {
    inner: { w: innerWidth, h: innerHeight },
    pageOverflow: document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1,
    scrollbarWidth: getComputedStyle(document.documentElement).scrollbarWidth,
    regions: { list: box(document.querySelector('.shell-list')), main: box(document.querySelector('.shell-main')), inspector: box(document.querySelector('.shell-inspector')) },
    list: box(document.getElementById('sessions-list')), thread: box(document.getElementById('sessions-thread')), inspector: box(document.getElementById('sessions-inspector')),
    head: box(document.getElementById('sessions-head')), scroll: box(document.getElementById('sessions-thread-scroll')), dock: box(document.getElementById('sessions-dock')), compose: box(document.getElementById('sessions-compose')), send: box(document.getElementById('sessions-send')), input: box(document.getElementById('sessions-input')),
    itabs: box(document.getElementById('sessions-itabs')), ibody: box(document.getElementById('sessions-inspector-scroll')),
    small, scrollers, wide, spill,
    fold: document.documentElement.dataset.layoutFold || '',
  };`;

// ---- what a person can read, in real pixels: no text under 12 px and none under 4.5:1 against what is behind it ----------------------------
// Runs in the page for the visible text under `rootSelector`. The background is every layer behind the text, from the page's own
// background up, each composited with its alpha (a gradient counts as the mean of its stops); text in a control that is disabled or
// faded (opacity under 1) is left out, as WCAG leaves it out. Answers the failures and what was looked at.
function readableProbe(rootSelector) {
  const parse = (value) => {
    const text = String(value || "").trim();
    let match = /^rgba?\(([^)]+)\)$/.exec(text);
    if (match) { const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }; }
    match = /^color\(srgb ([^)]+)\)$/.exec(text);
    if (match) { const [rgb, alpha] = match[1].split("/"); const channels = rgb.trim().split(/\s+/).map(Number); return { r: channels[0] * 255, g: channels[1] * 255, b: channels[2] * 255, a: alpha === undefined ? 1 : Number(alpha) }; }
    return null;
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const gradient = (image) => {
    const stops = String(image || "").match(/rgba?\([^)]+\)|color\(srgb [^)]+\)/g);
    if (!stops || !/gradient/.test(image)) return null;
    const colors = stops.map(parse).filter(Boolean);
    if (!colors.length) return null;
    const mean = (key) => colors.reduce((sum, color) => sum + color[key], 0) / colors.length;
    return { r: mean("r"), g: mean("g"), b: mean("b"), a: mean("a") };
  };
  const luminance = (color) => { const channel = (value) => { const v = value / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b); };
  const ratio = (a, b) => { const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (hi + 0.05) / (lo + 0.05); };
  const base = parse(getComputedStyle(document.documentElement).getPropertyValue("--bg")) || parse(getComputedStyle(document.body).backgroundColor) || { r: 0, g: 0, b: 0, a: 1 };
  const root = document.querySelector(rootSelector);
  if (!root) return { missing: rootSelector, failures: [], small: [], looked: 0 };
  const shown = (node) => { const r = node.getBoundingClientRect(); const s = getComputedStyle(node); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
  const leaves = [...root.querySelectorAll("*")].filter((node) => shown(node) && [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim()));
  const failures = [], small = [];
  let looked = 0, skipped = 0;
  for (const node of leaves) {
    if (parseFloat(getComputedStyle(node).fontSize) < 12) small.push(`${node.className || node.tagName}:${getComputedStyle(node).fontSize}:${node.textContent.trim().slice(0, 24)}`);
    let faded = false;
    const chain = [];
    for (let walk = node; walk && walk.nodeType === 1; walk = walk.parentElement) {
      const style = getComputedStyle(walk);
      if (Number(style.opacity) < 0.99 || walk.disabled === true || walk.getAttribute?.("aria-disabled") === "true") faded = true;
      chain.push(style);
    }
    if (faded) { skipped += 1; continue; }
    let behind = base;
    for (const style of chain.reverse()) {
      const fill = gradient(style.backgroundImage) || parse(style.backgroundColor);
      if (fill && fill.a > 0) behind = over(fill, behind);
    }
    const ink = parse(getComputedStyle(node).color);
    if (!ink) continue;
    looked += 1;
    const value = ratio(over(ink, behind), behind);
    if (value < 4.5) failures.push({ text: node.textContent.trim().slice(0, 40), cls: String(node.className || node.tagName).slice(0, 40), ratio: Math.round(value * 100) / 100 });
  }
  return { failures, small, looked, skipped };
}

app.whenReady().then(async () => {
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    let allowed = /^(data:|blob:|devtools:)/.test(details.url);
    if (details.url.startsWith("file:")) { const relative = path.relative(root, fileURLToPath(details.url)); allowed = !relative.startsWith("..") && !path.isAbsolute(relative); }
    if (!allowed) report.networkAttempts.push(details.url);
    callback({ cancel: !allowed });
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8"));
  seed.catalog = catalog; seed.ids = { wide: PIC_WIDE, tall: PIC_TALL };
  const preload = path.join(root, "sessions-preload.cjs");
  fs.writeFileSync(preload, `(${bridge.toString()})(${JSON.stringify(seed)});
    localStorage.setItem('mefiStudio.commandHome','0');localStorage.setItem('mefiStudio.zen','0');localStorage.setItem('mefiStudio.zenReactive','0');localStorage.setItem('mefiStudio.keyHint.v1','1');localStorage.setItem('mefiStudio.walkthrough.v1',JSON.stringify({version:1,step:0,status:'complete'}));localStorage.setItem('mefiStudio.whatsNew.seen','vibe-build-1');
  `);
  const window = new BrowserWindow({ show: false, width: 1440, height: 900, frame: false, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (condition, label, ms = 12000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${condition});`)) return; await sleep(40); }
    fs.writeFileSync(path.join(root, "sessions-failure.png"), (await contents.capturePage()).toPNG());
    throw new Error(`Timed out: ${label}`);
  };
  const capture = async (name) => {
    await run("await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));");
    await sleep(200);
    fs.writeFileSync(path.join(root, name), (await contents.capturePage()).toPNG());
    report.shots.push(name);
  };
  const size = async (width, height, zoom = 1) => { window.setContentSize(width, height); contents.setZoomFactor(zoom); await sleep(350); };
  const step = (label) => report.steps.push(label);
  report.shots = [];
  // The phases are named so a failing one can be run alone while debugging: MEFI_SESSIONS_PHASE=shots|chrome|today (default: all).
  const only = process.env.MEFI_SESSIONS_PHASE || "all";

  // ---- v2 ----------------------------------------------------------------------------------------------------------------------------------
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1", layout: "v2" } });
  await until("window.MefiNav && window.MefiWorkspace && window.MefiSessions && !window.MefiBoot?.isActive?.()", "studio ready (v2)");
  assert.equal(await run("return document.documentElement.dataset.layout;"), "v2");
  await until("window.MefiShell && window.MefiShell.active()", "the shell's frame is up (v2)");
  await run("window.MefiVibe.setMode('build', { go: false }); window.MefiNav.applyShell(true); window.MefiNav.setRailPinned(false, { save: false });");
  await run("window.MefiNav.go('workspace');");
  await until("document.body.classList.contains('workspace-active')", "Home is up (v2)");
  // The shell arrived after the layout was on: the panels draw as soon as it says its regions moved (or at the next look).
  try { await until("window.MefiSessions.active()", "the panels are drawn once the shell is there", 8000); } catch (error) {
    report.attachProbe = await run("try { return { attach: window.MefiSessions.attach(), active: window.MefiSessions.active(), layout: document.documentElement.dataset.layout, shell: typeof window.MefiShell, snapshot: typeof window.MefiWorkspace.snapshot, builder: typeof window.MefiBuilder } } catch (error) { return { error: String(error.stack) }; }");
    console.error(JSON.stringify(report.attachProbe), JSON.stringify(report.errors));
    throw error;
  }
  await until("document.querySelectorAll('#sessions-list .sx-row').length >= 9", "the list shows the board");
  await sleep(500);
  step("v2 draws into the shell's regions");
  await size(1440, 900);
  await capture("sessions-list-only-1440.png");
  if (only === "shots") {
    await run("window.MefiSessions.select('task_ask');");
    await until("document.getElementById('sessions-thread') && !document.getElementById('sessions-thread').hidden && document.querySelector('#sessions-head .sx-title')?.textContent.includes('empty state')", "the thread shows the session");
    await sleep(900);
    await capture("sessions-ask-1440.png");
    await run("window.MefiSessions.select('task_review');");
    await until("document.querySelector('#sessions-head .sx-title')?.textContent.includes('Markdown')", "the review session shows");
    await sleep(900);
    await capture("sessions-review-1440.png");
    await run("window.MefiSessions.select('task_run');");
    await until("document.querySelector('#sessions-head .sx-title')?.textContent.includes('tag')", "the running session shows");
    await sleep(900);
    await capture("sessions-run-1440.png");
    report.measure = await run(measure);
    // MEFI_SESSIONS_PROBE_FILE: a file of script to run in the page at this point (debugging a layout), its answer kept in the report.
    if (process.env.MEFI_SESSIONS_PROBE_FILE) { await run("window.MefiSessions.select('task_ask');"); await sleep(900); report.probe = await run(fs.readFileSync(process.env.MEFI_SESSIONS_PROBE_FILE, "utf8")); console.log("PROBE", JSON.stringify(report.probe, null, 1)); }
    finish();
    return;
  }

  // ---- helpers for what follows ---------------------------------------------------------------------------------------------------------
  const press = async (key, modifiers = []) => {
    contents.focus();
    contents.sendInputEvent({ type: "keyDown", keyCode: key, modifiers });
    if (key === "Enter") contents.sendInputEvent({ type: "char", keyCode: "\r", modifiers });
    contents.sendInputEvent({ type: "keyUp", keyCode: key, modifiers });
    await sleep(140);
  };
  const q = (selector) => JSON.stringify(selector);
  const click = (selector) => run(`const node = document.querySelector(${q(selector)}); if (!node) throw new Error('nothing matches ' + ${q(selector)}); node.click();`);
  const clickText = (selector, text) => run(`const node = [...document.querySelectorAll(${q(selector)})].find((item) => item.textContent.trim().startsWith(${q(text)})); if (!node) throw new Error('no ' + ${q(selector)} + ' starting ' + ${q(text)}); node.click();`);
  const textOf = (selector) => run(`return document.querySelector(${q(selector)})?.textContent ?? null;`);
  const count = (selector) => run(`return document.querySelectorAll(${q(selector)}).length;`);
  const focusOn = (selector) => run(`const node = document.querySelector(${q(selector)}); if (!node) throw new Error('nothing matches ' + ${q(selector)}); node.focus(); return document.activeElement === node;`);
  const focused = () => run("const a = document.activeElement; return a ? (a.closest('[data-key]')?.dataset.key || '') + '|' + (a.dataset.part || a.dataset.nav || a.id || a.tagName) : null;");
  const callsOf = (names) => run(`return window.sessionsFixture.calls().filter((call) => ${JSON.stringify(names)}.includes(call.name));`);
  const forget = () => run("window.sessionsFixture.clear();");
  const rows = () => run("return [...document.querySelectorAll('#sessions-list .sx-row')].map((node) => node.dataset.key);");
  const open = async (taskId, titlePart) => {
    await run(`document.querySelector('#sessions-list .sx-row[data-key=${taskId}] .sx-row-main').click();`);
    await until(`document.querySelector('#sessions-head .sx-title')?.textContent.includes(${q(titlePart)}) && !document.getElementById('sessions-thread').hidden`, `the thread shows ${taskId}`);
  };
  const settle = () => sleep(450);
  const toastAction = (label) => run(`const node = [...document.querySelectorAll('#toast-host .toast-action')].find((item) => item.textContent.trim() === ${q(label)}); if (!node) throw new Error('no toast action ' + ${q(label)}); node.click();`);
  const waitToast = (label) => until(`[...document.querySelectorAll('#toast-host .toast-action')].some((item) => item.textContent.trim() === ${q(label)})`, `a toast offers ${label}`);

  // ---- the chrome at 1920x1080, beside the prototype's shots (docs/prototype/): the status bar, Search and the Inbox ----------------------
  // Everything a person reads there is checked in every theme (12 px and 4.5:1, readableProbe). It runs on the board as it starts (the
  // question still open), on Build's Home with no session open, and leaves it as it found it: Chrome (the default) on, the player's own status back.
  const THEMES = ["chrome", "aurora", "gold", "midnight", "forest", "violet", "ember", "rose", "void", "eclipse", "abyss", "dusk"];
  const readable = async (rootSelector, label) => {
    const misses = [];
    for (const theme of THEMES) {
      await run(`window.MefiMusic.applyTheme(${q(theme)}, false); await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));`);
      const seen = await run(`return (${readableProbe.toString()})(${q(rootSelector)});`);
      assert.ok(!seen.missing && seen.looked > 0, `${label}: there is text to read under ${rootSelector}: ${JSON.stringify(seen)}`);
      assert.deepEqual(seen.small, [], `${label} (${theme}): no text under 12 px`);
      for (const miss of seen.failures) misses.push({ theme, ...miss });
    }
    await run("window.MefiMusic.applyTheme('chrome', false);");
    assert.deepEqual(misses, [], `${label}: every text reads at 4.5:1 or better in every theme`);
    (report.readable ||= {})[label] = THEMES.length;
  };
  const statusBar = `const bar = document.getElementById('shell-status'); const box = bar.getBoundingClientRect();
    const items = [...bar.querySelectorAll('[data-item]')].filter((node) => !node.hidden && getComputedStyle(node).display !== 'none').map((node) => { const r = node.getBoundingClientRect(); return { key: node.dataset.item, x: Math.round(r.left), r: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), text: node.textContent.trim() }; });
    return { bar: [Math.round(box.left), Math.round(box.top), Math.round(box.right), Math.round(box.bottom)], items, overlaps: items.slice(1).filter((one, at) => one.x < items[at].r - 0.5).map((one) => one.key), overflow: bar.scrollWidth > bar.clientWidth + 1 };`;
  async function chromeGallery() {
    await size(1920, 1080, 1);
    await run("for (const name of ['list', 'inspector']) window.MefiShell.open(name);");
    // Build's Home with no session open (a session would read its pictures, which the list's own checks below count).
    await until("window.MefiSessions.selected() === null && document.body.classList.contains('workspace-active')", "Build's Home, no session open");
    // The status bar: the machine's load from the watcher's push, the plan's two windows and today's cost from the usage reads, and a
    // player that plays (its status stood in: the fixture has no network to play anything from).
    await run("window.sessionsFixture.push('onMachineStatus', { wait: false, capacity: { canStart: true, reason: null, resources: { cpuPercent: 34.2, availableMemoryMB: 6390, totalMemoryMB: 16384, lagMs: 14 } } });");
    await run("window.__playerStatus = window.MefiMusic.status; window.MefiMusic.status = () => ({ ...window.__playerStatus(), playing: true, title: 'Deep Focus, hour two', source: 'local', queueLength: 1 }); window.dispatchEvent(new CustomEvent('mefi-music-change'));");
    await until("window.MefiUsageTracker?.brief?.()?.plan && ['machine', 'player', 'cost', 'waiting'].every((key) => !document.querySelector(`#shell-status [data-item=${key}]`).hidden)", "the status bar has its facts");
    await sleep(300);
    const wide = await run(statusBar);
    report.statusBar = wide;
    assert.deepEqual(wide.items.map((one) => one.key), ["layout", "working", "waiting", "player", "machine", "cost", "permission"], `the prototype's order: ${JSON.stringify(wide.items)}`);
    assert.deepEqual(wide.items.map((one) => one.text), ["Layout", "3 working", "2 waiting on you", "Deep Focus, hour two", "CPU 34% · Mem 61%", "$1.92 today", "Auto"]);
    assert.equal(await run("return document.querySelectorAll('#shell-status .shell-meter-button').length;"), 2, "the plan's two windows");
    assert.ok(wide.items.every((one) => one.top >= wide.bar[1] && one.bottom <= wide.bar[3]), `every item sits inside the bar: ${JSON.stringify(wide)}`);
    assert.deepEqual([wide.overlaps, wide.overflow], [[], false], "nothing overlaps and nothing is cut off");
    await capture("chrome-status-1920.png");
    await readable("#shell-status", "the status bar");
    // A small window keeps what matters: the machine's load and the meters go first.
    await size(600, 560, 1);
    const narrow = await run(statusBar);
    assert.deepEqual(narrow.items.map((one) => one.key).filter((key) => key === "machine"), [], "no machine load under 900 px");
    assert.deepEqual([narrow.overlaps, narrow.overflow], [[], false], `600 px: nothing overlaps or is cut off: ${JSON.stringify(narrow)}`);
    assert.equal(await run("return getComputedStyle(document.querySelector('#shell-status .shell-usage')).display;"), "none");
    await size(1920, 1080, 1);
    step("the status bar at 1920x1080 and 600 px");
    // Search (Ctrl K), the prototype's palette: under the bar and centred, 640 px, the box with its magnifier, one heading per group,
    // twelve rows (the sessions as the list orders them, the places, an action), each a line with its state or key on the right.
    const palette = `const sheet = document.querySelector('#palette-overlay .palette-sheet').getBoundingClientRect(); const bar = document.getElementById('shell-top').getBoundingClientRect(); const list = document.getElementById('palette-list').getBoundingClientRect(); const layer = document.getElementById('palette-overlay').getBoundingClientRect();
      const rows = [...document.querySelectorAll('#palette-list li.palette-row')].map((li) => ({ group: li.dataset.group, label: li.querySelector('.label').textContent, hint: li.querySelector('.hint')?.textContent || '', cut: li.scrollWidth > li.clientWidth + 1, inside: li.getBoundingClientRect().right <= sheet.right + 0.5 }));
      return { sheet: [Math.round(sheet.left), Math.round(sheet.top), Math.round(sheet.right), Math.round(sheet.bottom), Math.round(sheet.width)], layer: [Math.round(layer.left), Math.round(layer.right)], bar: Math.round(bar.bottom), inner: [innerWidth, innerHeight], rows,
        heads: [...document.querySelectorAll('#palette-list li.palette-heading')].map((li) => li.textContent), list: [Math.round(list.top), Math.round(list.bottom)],
        hint: document.getElementById('palette-hint').textContent, close: getComputedStyle(document.getElementById('palette-close')).display, placeholder: document.getElementById('palette-input').placeholder,
        lens: Boolean(document.querySelector('#palette-overlay .palette-search-glyph')), focused: document.activeElement?.id || '' };`;
    await press("K", ["control"]);
    await until("!document.getElementById('palette-overlay').hidden && document.querySelectorAll('#palette-list li.palette-row').length === 12", "Ctrl K opens Search with twelve rows");
    await sleep(350);
    const pal = await run(palette);
    report.palette = pal;
    assert.deepEqual(pal.heads, ["Sessions", "Places", "Actions"], `the empty box's groups: ${JSON.stringify(pal)}`);
    assert.deepEqual(pal.rows.map((row) => [row.label, row.hint]), [
      ["Add an empty state to the notes list", "Needs you"], ["Speed up the first paint on the map", "Needs you"], ["Search notes by tag", "Running"], ["Keyboard shortcut for a new note", "Running"], ["Export notes as Markdown", "Review"], ["Dark mode for the settings page", "Queued"],
      ["Go to Work", "H"], ["Go to Map", "D"], ["Go to Team", ""], ["Go to Friends", ""], ["Go to Settings", "Ctrl ,"], ["New task", "Ctrl N"],
    ], "the sessions as the list orders them, the rail's places with their keys, and New task");
    assert.equal(pal.sheet[4], 640, "640 px wide, as the prototype");
    assert.ok(Math.abs((pal.sheet[0] + pal.sheet[2]) / 2 - (pal.layer[0] + pal.layer[1]) / 2) <= 2 && pal.sheet[0] >= pal.layer[0] && pal.sheet[2] <= pal.layer[1], `centred in the free area, which every layer keeps to: ${JSON.stringify(pal)}`);
    assert.ok(pal.sheet[1] >= pal.bar && pal.sheet[1] <= pal.bar + 40, `just under the top bar: ${JSON.stringify(pal)}`);
    assert.ok(pal.rows.every((row) => !row.cut && row.inside), "no row is cut off");
    assert.deepEqual([pal.close, pal.lens, pal.focused, pal.placeholder], ["none", true, "palette-input", "Search, or type “task …” or “idea …” to add one"]);
    assert.equal(pal.hint, "↑↓ moveEnter openEsc closeAdding a task or idea only happens on Enter");
    await capture("chrome-palette-1920.png");
    await readable("#palette-overlay .palette-sheet", "Search");
    await run("const input = document.getElementById('palette-input'); input.value = 'permission'; input.dispatchEvent(new Event('input', { bubbles: true }));");
    await until("document.querySelector('#palette-list li.palette-row')", "a search shows its rows");
    const found = await run(palette);
    assert.ok(found.heads.includes("Permission mode") && found.rows.some((row) => row.label === "Set permission mode: Auto" && row.hint === "current"), `a search reaches the permission mode, the one in force says current: ${JSON.stringify(found.rows)}`);
    await capture("chrome-palette-search-1920.png");
    await size(600, 560, 1);
    const small = await run(palette);
    assert.ok(small.sheet[0] >= small.layer[0] && small.sheet[2] <= small.layer[1] && small.sheet[3] <= small.inner[1], `600 px: Search fits its free area: ${JSON.stringify(small)}`);
    assert.ok(small.rows.every((row) => !row.cut && row.inside), "600 px: no row is cut off");
    await size(1920, 1080, 1);
    await press("Escape");
    await until("document.getElementById('palette-overlay').hidden", "Escape closes Search");
    step("Search at 1920x1080 and 600 px");
    // One Inbox: the pill, the status bar, Home's own chip, the session list's Needs you and the popover all say the same two.
    await until("document.querySelector('#shell-need .shell-pill-n')?.textContent === '2'", "the pill counts the Inbox's two");
    const counts = await run(`return { pill: document.querySelector('#shell-need').textContent.trim(), bar: document.querySelector('#shell-status [data-item=waiting]').textContent.trim(), home: document.getElementById('workspace-attention-shortcut')?.textContent.trim() ?? null,
      needs: document.querySelector('#sessions-list .sx-gh[data-key="group:needs"] .sx-count')?.textContent ?? null, rows: [...document.querySelectorAll('#sessions-list .sx-row')].slice(0, 2).map((node) => node.dataset.key), today: window.MefiToday.count() };`);
    report.oneList = counts;
    assert.deepEqual(counts, { pill: "2 need you", bar: "2 waiting on you", home: "2 need you", needs: "2", rows: ["task_ask", "task_failed"], today: 2 }, `one list, one number: ${JSON.stringify(counts)}`);
    // The popover, under the pill: the prototype's cards.
    await click("#shell-need");
    await until("!document.getElementById('today-inbox').hidden && document.querySelectorAll('#today-inbox .today-need').length === 2", "the pill opens the Inbox with its two");
    await sleep(400);
    const inbox = `const pop = document.getElementById('today-inbox').getBoundingClientRect(); const pill = document.getElementById('shell-need').getBoundingClientRect();
      const cards = [...document.querySelectorAll('#today-inbox .today-need')].map((card) => ({ key: card.dataset.key, kind: card.querySelector('.today-need-label')?.textContent, from: card.querySelector('.today-need-from')?.textContent ?? '', title: card.querySelector('.today-need-title')?.textContent, glyph: Boolean(card.querySelector('.today-need-kind svg')),
        buttons: [...card.querySelectorAll('.today-need-options button')].map((node) => node.textContent.trim()), first: card.querySelector('.today-option.is-first')?.textContent.trim() ?? null, wide: card.scrollWidth > card.clientWidth + 1 }));
      return { pop: [Math.round(pop.left), Math.round(pop.top), Math.round(pop.right), Math.round(pop.bottom), Math.round(pop.width)], pill: [Math.round(pill.left), Math.round(pill.bottom), Math.round(pill.right)], inner: [innerWidth, innerHeight], cards, head: document.querySelector('#today-inbox .today-inbox-head')?.textContent.replace(/\\s+/g, ' ').trim() };`;
    const pop = await run(inbox);
    report.inbox = pop;
    assert.deepEqual(pop.cards.map((card) => [card.key, card.kind, card.from, card.glyph]), [["question:q_1", "Question · OpenCode", "Add an empty state to the notes list", true], ["blocked:task_failed", "Checks failed · Codex", "", true]], `what each is and who asked, the task it comes from: ${JSON.stringify(pop.cards)}`);
    assert.deepEqual(pop.cards[0].buttons, ["1Yes, reuse itRecommended", "2Only when there are no notes"], "the app's own options, the recommended first");
    assert.equal(pop.cards[0].first, "1Yes, reuse itRecommended", "the first is the filled one");
    assert.deepEqual(pop.cards[1].buttons, ["Try again", "It's done", "Drop it"]);
    assert.ok(pop.pop[1] >= pop.pill[1] && pop.pop[2] <= pop.inner[0] && pop.pop[3] <= pop.inner[1], `under the pill, inside the window: ${JSON.stringify(pop)}`);
    assert.equal(pop.pop[4], 452, "the prototype's width");
    assert.ok(pop.cards.every((card) => !card.wide), "nothing in a card is cut off");
    await capture("chrome-inbox-popover-1920.png");
    await readable("#today-inbox", "the Inbox popover");
    await press("Escape");
    await until("document.getElementById('today-inbox').hidden", "Escape closes the popover");
    // Work › Inbox: the page, in Work's pages, the tab counting the same two.
    await run("window.MefiNav.go('inbox');");
    await until("!document.getElementById('inbox-overlay').hidden && document.querySelectorAll('#inbox-list .today-need').length === 2", "Work › Inbox opens with its two");
    await sleep(500);
    const page = await run(`const list = document.getElementById('inbox-list'); const cards = [...list.querySelectorAll('.today-need')].map((card) => card.getBoundingClientRect());
      return { trail: [...document.querySelectorAll('#shell-top .shell-trail .shell-crumb')].map((node) => node.textContent), pages: [...document.querySelectorAll('#shell-pages-list .shell-page')].map((node) => [node.dataset.page, node.getAttribute('aria-current')]),
        tab: [...document.querySelectorAll('#shell-tabs .ts-item')].map((node) => [node.querySelector('.ts-title')?.textContent, node.querySelector('.ts-count')?.hidden === false ? node.querySelector('.ts-count').textContent : null]).find((row) => row[0] === 'Inbox') ?? null,
        lead: document.getElementById('inbox-lead').firstChild?.textContent ?? '', count: document.querySelector('#inbox-lead .inbox-count')?.textContent ?? '',
        columns: new Set(cards.map((box) => Math.round(box.left))).size, width: Math.round(list.getBoundingClientRect().width), rail: document.querySelector('#app-rail .app-rail-head[aria-current="page"]')?.dataset.section ?? null };`);
    report.inboxPage = page;
    assert.deepEqual(page.trail, ["Notes app", "Work", "Inbox"], "Work › Inbox, as the prototype's breadcrumb");
    assert.ok(page.pages.some(([id, current]) => id === "inbox" && current === "page"), `a page of Work's own: ${JSON.stringify(page.pages)}`);
    assert.deepEqual(page.tab, ["Inbox", "2"], "the tab counts the same two");
    assert.equal(page.rail, "work", "the rail says Work");
    assert.match(page.lead, /^Everything waiting on you in one place: .* Ctrl J opens the same list from anywhere\. $/);
    assert.equal(page.count, "2 things wait on you.");
    assert.equal(page.columns, 2, "two abreast at 1920 px, as the prototype");
    assert.ok(page.width <= 1021, `the page's own width, centred: ${page.width}`);
    await capture("chrome-inbox-page-1920.png");
    await readable("#inbox-overlay", "Work › Inbox");
    await size(600, 560, 1);
    const thin = await run("const list = document.getElementById('inbox-list').getBoundingClientRect(); const cards = [...document.querySelectorAll('#inbox-list .today-need')]; return { right: list.right, inner: innerWidth, wide: cards.some((card) => card.scrollWidth > card.clientWidth + 1), columns: new Set(cards.map((card) => Math.round(card.getBoundingClientRect().left))).size };");
    assert.ok(thin.right <= thin.inner + 1 && !thin.wide && thin.columns === 1, `600 px: one column, nothing cut off: ${JSON.stringify(thin)}`);
    await size(1920, 1080, 1);
    await run("window.MefiNav.close('inbox');");
    await until("document.getElementById('inbox-overlay').hidden", "the page closes");
    await run("window.MefiNav.go('workspace');");
    step("one Inbox: the pill, the status bar, Home, the list and the tab say the same; the popover and Work › Inbox at 1920 and 600 px");
    await run("window.MefiMusic.status = window.__playerStatus; delete window.__playerStatus; window.dispatchEvent(new CustomEvent('mefi-music-change'));");
    await size(1440, 900, 1);
  }
  if (only === "chrome") {
    await chromeGallery();
    assert.deepEqual(report.errors, [], "no console errors");
    report.complete = true;
    finish();
    return;
  }

  // ---- Today at 1920x1080, beside the prototype's shots (docs/prototype/): Build's Home with no session open, and Vibe's board ----------
  // Build's Home is Today (renderer/today.js mountHome): the greeting and the question, Home's own box with the prototype's row of
  // controls, the ways to start, the first thing that needs you, Running now and Finished while you were away. Everything on it is
  // read in every theme (12 px and 4.5:1). Vibe's Today is captured on the same board. It leaves Build's Home as it found it.
  const todayFacts = `
    const box = (node) => { if (!node) return null; const r = node.getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), r: Math.round(r.right), b: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }; };
    const page = document.getElementById('today-build');
    const shown = (node) => { const r = node.getBoundingClientRect(); const s = getComputedStyle(node); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const texts = [...page.querySelectorAll('*')].filter((node) => shown(node) && [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim()));
    const area = window.MefiNav.usable(); const main = { left: area.left, right: area.right, top: area.top, bottom: area.bottom };
    return {
      classic: getComputedStyle(document.querySelector('#workspace-layer .ws-main')).display,
      kicker: document.getElementById('today-build-kicker').textContent, title: document.getElementById('today-build-title').textContent,
      boxed: document.getElementById('workspace-form').parentNode.id, placeholder: document.getElementById('workspace-input').placeholder,
      tools: [...document.querySelectorAll('#today-build-tools > :not([hidden])')].filter(shown).map((node) => node.id), autonomy: document.querySelector('#today-build-autonomy .autonomy-chip')?.textContent ?? null,
      starts: [...document.querySelectorAll('#today-build-starts button')].map((node) => node.textContent.trim()),
      need: { key: document.querySelector('#today-build-need > *')?.dataset.key ?? null, head: document.querySelector('#today-build-need .today-b-ask-k b')?.textContent ?? null, words: document.querySelector('#today-build-need .today-b-ask-q')?.textContent ?? null, buttons: [...document.querySelectorAll('#today-build-need .today-b-opts button')].map((node) => node.textContent) },
      running: [...document.querySelectorAll('#today-build-running .today-b-row')].map((node) => [node.querySelector('.today-b-row-title').textContent, node.querySelector('.today-b-row-meta').textContent]),
      finished: [...document.querySelectorAll('#today-build-finished .today-b-row')].map((node) => [node.querySelector('.today-b-row-title').textContent, node.querySelector('.today-b-row-meta').textContent]),
      col: box(page.querySelector('.today-b-col')), form: box(document.getElementById('workspace-form')), talk: box(document.getElementById('today-build-talk')), build: box(document.getElementById('today-build-build')), two: [...page.querySelectorAll('.today-b-half')].map(box),
      main: { x: Math.round(main.left), r: Math.round(main.right), y: Math.round(main.top), b: Math.round(main.bottom) },
      small: texts.filter((node) => parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => (node.id || node.className) + ':' + getComputedStyle(node).fontSize),
      outside: [...page.querySelectorAll('*')].filter(shown).filter((node) => { const r = node.getBoundingClientRect(); return r.right > innerWidth + 1 || r.left < -1; }).map((node) => node.id || node.className),
      gutters: [...page.querySelectorAll('*')].filter((node) => shown(node) && /(auto|scroll)/.test(getComputedStyle(node).overflowY)).map((node) => node.offsetWidth - node.clientWidth),
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      trail: [...document.querySelectorAll('#shell-top .shell-crumb')].map((node) => node.textContent),
    };`;
  async function todayGallery() {
    await size(1920, 1080, 1);
    await run("for (const name of ['list', 'inspector']) window.MefiShell.open(name);");
    await run("window.MefiNav.go('workspace');");
    await until("window.MefiSessions.selected() === null && window.MefiToday.hostsComposer() && !document.getElementById('today-build').hidden && document.querySelector('#today-build-need > *') && document.querySelectorAll('#today-build-running .today-b-row').length >= 1", "Build's Home is Today");
    await sleep(700);
    const wide = await run(todayFacts);
    report.todayBuild = wide;
    assert.equal(wide.classic, "none", "the classic page steps aside");
    assert.equal(wide.title, "What's next for Notes app?");
    assert.match(wide.kicker, /^(Up late|Good morning|Good afternoon|Good evening)$/);
    assert.equal(wide.boxed, "today-build-box", "Home's own box is Today's");
    assert.equal(wide.placeholder, "Describe an idea, a fix or a question…");
    assert.deepEqual(wide.tools, ["today-build-attach", "today-build-autonomy", "today-build-chat-tools", "today-build-talk", "today-build-build"], "Add files or an image, the mode, how Mefi answers, Talk it over, Build it");
    assert.equal(wide.autonomy, "Auto", "the permission mode reads as the prototype's");
    assert.deepEqual(wide.starts, ["Modify", "Experiment", "Fix", "Improve", "Suggest a next step"]);
    assert.deepEqual(wide.need, { key: "question:q_1", head: "Add an empty state to the notes list", words: "Should the empty state also appear when a search has no matches?", buttons: ["Yes, reuse it", "Only when there are no notes", "Open task"] }, "the open question, as the prototype's Needs you card");
    assert.deepEqual(wide.running.map((row) => row[0]), ["Search notes by tag", "Keyboard shortcut for a new note"], "the run waiting on you is under Needs you only, as the prototype draws it");
    assert.equal(wide.running[0][1], "Claude Code · Writing parseTags()");
    assert.ok(wide.finished.length >= 1 && wide.finished.length <= 3, `what finished, three at most: ${JSON.stringify(wide.finished)}`);
    assert.ok(Math.abs((wide.col.x + wide.col.r) / 2 - (wide.main.x + wide.main.r) / 2) <= 2 && wide.col.w <= 830, `the column is centred in the free area and no wider than the prototype's: ${JSON.stringify([wide.col, wide.main])}`);
    assert.ok(wide.form.w <= 780 && wide.talk.y === wide.build.y && wide.talk.r < wide.build.x, `the box is the prototype's width, Talk it over beside Build it: ${JSON.stringify([wide.form, wide.talk, wide.build])}`);
    assert.equal(wide.two.length, 2);
    assert.ok(wide.two[0].y === wide.two[1].y && wide.two[0].r < wide.two[1].x, `Running now and Finished side by side: ${JSON.stringify(wide.two)}`);
    assert.deepEqual([wide.small, wide.outside, wide.pageOverflow], [[], [], false], "no text under 12 px, nothing outside the window");
    assert.ok(wide.gutters.every((gutter) => gutter === 0), `no scroller reserves width: ${wide.gutters}`);
    assert.deepEqual(wide.trail, ["Notes app", "Today"]);
    await capture("today-build-1920.png");
    await readable("#today-build", "Build's Today");
    // Open the conversation: the classic Home, under its own tab, named Chat; Today comes back on Today.
    await run("window.MefiToday.openChat();");
    await until("!window.MefiToday.hostsComposer() && getComputedStyle(document.querySelector('#workspace-layer .ws-main')).display !== 'none' && document.getElementById('workspace-form').closest('.ws-conversation')", "the conversation is the classic Home");
    await sleep(300);
    assert.deepEqual(await run("return [...document.querySelectorAll('#shell-top .shell-crumb')].map((node) => node.textContent);"), ["Notes app", "Chat"]);
    await capture("today-build-chat-1920.png");
    await run("window.MefiNav.go('workspace');");
    await until("window.MefiToday.hostsComposer() && !document.getElementById('today-build').hidden", "Today again");
    // A small window: one column, nothing outside, nothing under 12 px.
    for (const [width, height, zoom] of [[1100, 720, 1], [600, 560, 1], [600, 560, 1.5]]) {
      await size(width, height, zoom);
      await sleep(300);
      const small = await run(todayFacts);
      assert.deepEqual([small.small, small.outside, small.pageOverflow], [[], [], false], `${width}x${height}@${zoom}: ${JSON.stringify([small.small, small.outside])}`);
      await capture(`today-build-${width}x${height}@${zoom}.png`);
    }
    await size(1920, 1080, 1);
    // Vibe's Today on the same board.
    await run("await window.MefiVibe.setMode('vibe'); window.MefiNav.setRailPinned(false, { save: false });");
    await until("document.getElementById('vibe-layer').dataset.today === 'on' && !document.getElementById('vibe-layer').hidden && document.querySelector('#today-board .today-group')", "Vibe's Today");
    await sleep(900);
    await capture("today-vibe-1920.png");
    report.todayVibe = await run("return { trail: [...document.querySelectorAll('#shell-top .shell-crumb')].map((node) => node.textContent), groups: [...document.querySelectorAll('#today-board .today-group')].map((node) => [node.dataset.group, node.querySelector('h3').firstChild.textContent, node.querySelectorAll('.today-card, .today-need').length, node.hidden]), need: { title: document.querySelector('#today-board [data-group=needs] .today-card-title')?.textContent ?? null, meta: document.querySelector('#today-board [data-group=needs] .today-card-meta')?.textContent ?? null, q: document.querySelector('#today-board [data-group=needs] .today-card-q')?.textContent ?? null }, kicker: getComputedStyle(document.querySelector('#today-page .vibe-kicker'), '::after').content, build: document.querySelector('#vibe-build .today-key')?.textContent ?? null, send: document.getElementById('vibe-talk')?.textContent ?? null, buildShown: getComputedStyle(document.getElementById('vibe-build')).display !== 'none', rail: getComputedStyle(document.getElementById('vibe-rail')).display !== 'none' };");
    assert.deepEqual(report.todayVibe.trail, ["Notes app", "Home"], "Social calls its Home what its rail calls it");
    // Social's Home lists the work in short (a QA pass on 2026-10-06): a group only while it holds something, in one set of words.
    const shownGroups = report.todayVibe.groups.filter((group) => !group[3]);
    assert.ok(shownGroups.length >= 2 && shownGroups.every((group) => group[2] > 0), `a group only while it holds something: ${JSON.stringify(report.todayVibe.groups)}`);
    assert.ok(shownGroups.every((group) => ["Needs you", "Running", "Up next", "Paused", "Agents off", "No AI connected", "In review", "Done today"].includes(group[1])), `one set of words for where work stands: ${JSON.stringify(shownGroups)}`);
    assert.equal(report.todayVibe.groups.find((group) => group[0] === "done")[3], true, "nothing finished today: no empty Done column");
    assert.match(report.todayVibe.send, /^Send/, "the box's one action");
    assert.equal(report.todayVibe.buildShown, false, "Build it is a key in Social (Ctrl Enter), not a second button");
    assert.equal(report.todayVibe.rail, true, "Social's rail stands beside its Home");
    assert.deepEqual({ ...report.todayVibe.need, meta: report.todayVibe.need.meta?.replace(/\d+ min$/, "N min") }, { title: "Add an empty state to the notes list", meta: "Asking a question · N min", q: "Should the empty state also appear when a search has no matches?" }, "a card that waits on you is its session: the task, what it asks and for how long, the question in its box");
    assert.equal(report.todayVibe.kicker, '" · Social"', "the calm mode is called Social now");
    assert.equal(report.todayVibe.build, "Ctrl Enter");
    await readable("#today-page", "Vibe's Today");
    await run("await window.MefiVibe.setMode('build', { go: false }); window.MefiNav.applyShell(true); window.MefiNav.setRailPinned(false, { save: false }); window.MefiNav.go('workspace');");
    await until("window.MefiToday.hostsComposer() && !document.getElementById('today-build').hidden", "Build's Today again");
    await size(1440, 900, 1);
    step("Today at 1920x1080 and three small windows, Build's and Vibe's");
  }
  if (only === "today") {
    await todayGallery();
    assert.deepEqual(report.errors, [], "no console errors");
    report.complete = true;
    finish();
    return;
  }

  // ---- the list ---------------------------------------------------------------------------------------------------------------------------
  const groups = await run("return [...document.querySelectorAll('#sessions-list .sx-gh')].map((node) => [node.dataset.key, node.firstElementChild.textContent, node.querySelector('.sx-count').textContent]);");
  assert.deepEqual(groups, [["group:needs", "Needs you", "2"], ["group:running", "Running", "2"], ["group:review", "Review", "1"], ["group:queued", "Queued", "2"], ["group:done", "Done", "3"]], "the board is grouped by where each task stands");
  assert.deepEqual(await rows(), ["task_ask", "task_failed", "task_run", "task_run2", "task_review", "task_queued", "task_queued2", "task_done", "task_done2", "task_done3"], "newest first within each group");
  const lines = await run("return Object.fromEntries([...document.querySelectorAll('#sessions-list .sx-row')].map((node) => [node.dataset.key, node.querySelector('.sx-row-meta')?.textContent || '']));");
  assert.equal(lines.task_ask, "Asking a question · waiting 4m");
  assert.equal(lines.task_run, "Claude Code · Writing parseTags()");
  assert.match(lines.task_done, /^Verified · 1d/);
  assert.equal(await textOf("#sessions-project .sx-proj-words b"), "Notes app");
  assert.equal(await textOf("#sessions-project .sx-proj-words small"), "main");
  assert.equal(await textOf("#sessions-tab-backlog"), "Backlog · 2");
  step("the list is grouped and worded");
  // The chrome gallery runs here, after the list's words that count time (it takes a while: every theme, four times), and before
  // anything changes the board.
  await chromeGallery();
  await todayGallery();
  // The head as the prototype has it: the Git chip (git-sync.js's, branch then state) and the worktrees chip, then the project menu.
  await until("document.querySelector('#sessions-gitrow .gs-chip') && !document.querySelector('#sessions-gitrow .gs-slot').hidden", "the Git chip sits under the project");
  assert.equal(await textOf("#sessions-gitrow .gs-chip-branch-name"), "main");
  assert.equal(await textOf("#sessions-gitrow .gs-chip-label"), "3 changes");
  await until("document.getElementById('sessions-worktrees') && !document.getElementById('sessions-worktrees').hidden", "the worktrees chip counts the project's other checkouts");
  assert.equal((await textOf("#sessions-worktrees")).trim(), "1 worktree");
  await click("#sessions-gitrow .gs-chip");
  await until("document.querySelector('.gs-pop') && !document.querySelector('.gs-pop').hidden", "the chip opens the one Git popover");
  await press("Escape");
  await until("!document.querySelector('.gs-pop') || document.querySelector('.gs-pop').hidden", "Escape closes it");
  await click("#sessions-project");
  await until("document.getElementById('sessions-project-menu')", "the project menu opens on the head");
  const menuItems = await run("return [...document.querySelectorAll('#sessions-project-menu .sx-menu-words > span')].map((node) => node.textContent);");
  assert.equal(menuItems[0], "Notes app"); assert.ok(menuItems.includes("Open a folder…") && menuItems.includes("All projects…"), JSON.stringify(menuItems));
  assert.equal(await run("return document.activeElement?.closest('#sessions-project-menu') !== null && document.activeElement?.getAttribute('aria-checked') === 'true';"), true, "the keyboard starts on the open project");
  const menuBox = await run("const m = document.getElementById('sessions-project-menu').getBoundingClientRect(), l = document.getElementById('sessions-list').getBoundingClientRect(); return { inside: m.left >= l.left - 1 && m.right <= l.right + 1, w: m.width };");
  assert.ok(menuBox.inside && menuBox.w > 180, `the menu sits inside the list: ${JSON.stringify(menuBox)}`);
  await capture("sessions-project-menu-1440.png");
  await press("Escape");
  await until("!document.getElementById('sessions-project-menu')", "Escape closes the project menu");
  assert.equal(await run("return document.activeElement?.id;"), "sessions-project", "and gives the head its focus back");
  step("the head has the project menu, the Git chip and the worktrees");

  // What a row says follows html[data-detail]: titles, then status (the default), then everything.
  const level = async (value) => {
    await run(`${value ? `document.documentElement.dataset.detail = ${q(value)};` : "delete document.documentElement.dataset.detail;"} await new Promise((resolve) => requestAnimationFrame(resolve));`);
    return run("const row = document.querySelector('#sessions-list .sx-row[data-key=task_run]'); const show = (selector) => { const node = row.querySelector(selector); return node ? getComputedStyle(node).display : null; }; return { meta: show('.sx-row-meta'), more: show('.sx-row-more'), bar: show('.sx-row-bar'), moreText: row.querySelector('.sx-row-more')?.textContent || '' };");
  };
  const titlesOnly = await level("titles"), statusToo = await level("status"), everything = await level("all"), plainDefault = await level("");
  assert.deepEqual([titlesOnly.meta, titlesOnly.more, titlesOnly.bar], ["none", "none", "none"], "titles only: nothing under a title");
  assert.deepEqual([statusToo.meta, statusToo.more, statusToo.bar], ["block", "none", "block"], "titles and status: one line and the bar");
  assert.deepEqual([everything.meta, everything.more, everything.bar], ["block", "block", "block"], "everything: who, where and how far");
  assert.match(everything.moreText, /Claude Code/); assert.match(everything.moreText, /mefi\/tag-search/); assert.match(everything.moreText, /own worktree|mefi\/tag-search/);
  assert.deepEqual([plainDefault.meta, plainDefault.more], ["block", "none"], "no setting is the middle one");
  step("rows follow html[data-detail]");

  // A run in its own worktree wears the branch mark, and no other row does.
  assert.equal(await count("#sessions-list .sx-row[data-key=task_run] .sx-branch"), 1);
  assert.equal(await count("#sessions-list .sx-branch"), 1);
  await capture("sessions-list-1440.png");

  // The keys: arrows move between rows (past the row's own menu), Home and End go to the ends, Enter opens.
  await focusOn("#sessions-list .sx-row[data-key=task_ask] .sx-row-main");
  await press("Down"); assert.equal(await focused(), "task_failed|main", "Down goes to the next row");
  await press("Up"); assert.equal(await focused(), "task_ask|main", "Up goes back");
  await press("Right"); assert.equal(await focused(), "task_ask|menu", "Right reaches the row's menu button");
  await press("Left"); assert.equal(await focused(), "task_ask|main");
  await press("End"); assert.equal(await focused(), "task_done3|main", "End goes to the last row");
  await press("Home"); assert.equal(await focused(), "group:needs|group", "Home goes to the first group");
  await press("Down"); await press("Down"); await press("Enter");
  await until("document.querySelector('#sessions-head .sx-title')?.textContent.includes('first paint')", "Enter opens the row that has focus");
  assert.equal(await run("return window.MefiSessions.selected();"), "task_failed");
  step("the list's keys work");

  // The filter box.
  await run("const input = document.getElementById('sessions-find'); input.value = 'by tag'; input.dispatchEvent(new Event('input', { bubbles: true }));");
  assert.deepEqual(await rows(), ["task_run"], "a word narrows the list to the tasks that have it");
  await run("const input = document.getElementById('sessions-find'); input.value = 'zzzz'; input.dispatchEvent(new Event('input', { bubbles: true }));");
  assert.match(await textOf("#sessions-list .sx-empty"), /No session matches/);
  await focusOn("#sessions-find"); await press("Escape");
  assert.equal(await run("return document.getElementById('sessions-find').value;"), "", "Escape clears the filter");
  assert.equal((await rows()).length, 10);
  // Sessions | Backlog.
  await click("#sessions-tab-backlog");
  assert.deepEqual(await rows(), ["idea:idea_1", "idea:idea_2"], "the backlog lists the ideas nobody has made a task of");
  await click("#sessions-tab-sessions");
  assert.equal((await rows()).length, 10);
  step("the filter and the Backlog tab work");

  // The row's menu: pin, rename, delete with its confirm and its Undo.
  await click("#sessions-list .sx-row[data-key=task_done2] .sx-row-menu");
  const menu = await run("return [...document.querySelectorAll('.sx-menu .sx-menu-item')].map((node) => node.textContent.trim());");
  const tabs = await run("return typeof window.MefiTabs?.open === 'function';");
  assert.deepEqual(menu, [tabs ? "Open in a new tab" : "Open", "Pin to the top", "Rename", "Delete"], `the menu of a finished task: ${JSON.stringify(menu)}`);
  await clickText(".sx-menu .sx-menu-item", "Pin to the top");
  await until("document.querySelector('#sessions-list .sx-row[data-key=task_done2] .sx-pin')", "the pin shows");
  assert.deepEqual((await rows()).slice(-3), ["task_done2", "task_done", "task_done3"], "a pinned task goes first in its group");
  await click("#sessions-list .sx-row[data-key=task_done2] .sx-row-menu");
  await clickText(".sx-menu .sx-menu-item", "Unpin");
  await until("!document.querySelector('#sessions-list .sx-pin')", "the pin is gone");
  await click("#sessions-list .sx-row[data-key=task_queued2] .sx-row-menu");
  assert.equal(await run("return [...document.querySelectorAll('.sx-menu .sx-menu-item')].map((node) => node.textContent.trim()).includes('Stop this task');"), false, "a task nothing is running has no Stop");
  await clickText(".sx-menu .sx-menu-item", "Rename");
  await until("document.querySelector('#sessions-list .sx-rename')", "the row turns into a box for its new name");
  await forget();
  await run("const input = document.querySelector('#sessions-list .sx-rename'); input.value = 'Pin notes to the top'; input.dispatchEvent(new Event('input', { bubbles: true }));");
  await focusOn("#sessions-list .sx-rename"); await press("Enter");
  await until("window.sessionsFixture.calls().some((call) => call.name === 'tasksAction')", "the rename goes to the host");
  assert.deepEqual((await callsOf(["tasksAction"]))[0].args[0], { taskId: "task_queued2", projectId, action: "rename", title: "Pin notes to the top" });
  await until("document.querySelector('#sessions-list .sx-row[data-key=task_queued2] .sx-row-title')?.textContent === 'Pin notes to the top'", "the new name shows");
  await forget();
  await click("#sessions-list .sx-row[data-key=task_done3] .sx-row-menu");
  await clickText(".sx-menu .sx-menu-item", "Delete");
  await waitToast("Delete"); await toastAction("Delete");
  await until("!document.querySelector('#sessions-list .sx-row[data-key=task_done3]')", "the deleted task leaves the list");
  assert.equal((await callsOf(["tasksDelete"])).length, 1);
  await waitToast("Undo"); await toastAction("Undo");
  await until("document.querySelector('#sessions-list .sx-row[data-key=task_done3]')", "Undo puts it back");
  assert.equal((await callsOf(["tasksUndelete"])).length, 1, "Undo goes through Recently deleted");
  step("the row menu works: pin, rename, delete and Undo");

  // ---- a question that waits on you ----------------------------------------------------------------------------------------------------
  await forget();
  await open("task_ask", "empty state");
  await until("document.querySelectorAll('#sessions-thread .sx-thumb img').length >= 2", "the brief's two pictures arrive");
  await settle();
  const thumbs = await run("return [...document.querySelectorAll('#sessions-thread .sx-thumb img')].map((img) => ({ natural: [img.naturalWidth, img.naturalHeight], fit: getComputedStyle(img).objectFit, box: [Math.round(img.getBoundingClientRect().width), Math.round(img.getBoundingClientRect().height)] }));");
  assert.deepEqual(thumbs.map((item) => item.natural), [[960, 300], [360, 720]], "the pictures a brief names are read back by their ids and shown whole");
  assert.ok(thumbs.every((item) => item.fit === "contain" && item.box[0] > 20 && item.box[1] > 20), `they are scaled to fit, never cropped: ${JSON.stringify(thumbs)}`);
  assert.deepEqual((await callsOf(["assistantImageRead"])).map((call) => call.args[0].id).sort(), [PIC_TALL, PIC_WIDE].sort(), "the host is asked for a picture by its opaque id, nothing else");
  const dock = await run("return { options: [...document.querySelectorAll('#sessions-dock .sx-ask-opts button')].map((node) => node.textContent.trim()), suggest: document.querySelector('#sessions-dock .sx-ask-suggest')?.textContent || '', countdown: /auto|in \\d+ min/i.test(document.getElementById('sessions-dock').textContent), hidden: document.getElementById('sessions-dock').hidden };");
  assert.deepEqual(dock.options, ["Yes, reuse it", "Only when there are no notes", "Decide later"], "the option it recommends comes first, then the others, then Decide later");
  assert.match(dock.suggest, /Mefi suggests .Yes, reuse it./);
  assert.equal(dock.countdown, false, "no countdown: this app has no auto-decide to count down to");
  await capture("sessions-question-1440.png");
  await clickText("#sessions-dock .sx-ask-opts button", "Decide later");
  await until("document.querySelector('#sessions-dock .sx-ask.mini.later')", "Decide later puts the card away");
  assert.equal(await run("const all = [...document.querySelectorAll('#sessions-list .sx-gh, #sessions-list .sx-row')]; return all.findIndex((node) => node.dataset.key === 'task_ask') < all.findIndex((node) => node.dataset.key === 'group:running');"), true, "it stays in Needs you");
  await clickText("#sessions-dock button", "Answer now");
  await until("document.querySelector('#sessions-dock .sx-ask:not(.mini)')", "the card comes back");
  await forget();
  await clickText("#sessions-dock .sx-ask-opts button", "Yes, reuse it");
  await until("window.sessionsFixture.calls().some((call) => call.name === 'assistantAnswer')", "the answer goes to the host");
  assert.deepEqual((await callsOf(["assistantAnswer"]))[0].args[0], { id: "q_1", optionId: "yes" });
  await until("!document.querySelector('#sessions-dock .sx-ask')", "the answered question leaves the dock");
  await until("document.querySelector('#sessions-list .sx-row[data-key=task_ask]')?.dataset.tone === 'run'", "the list follows the answer: the task is working again");
  step("the question card answers, folds and comes back");

  // ---- the box at the foot: Note, Ask, Change ----------------------------------------------------------------------------------------------
  const box = () => run("return { intent: document.getElementById('sessions-compose').dataset.intent, pressed: [...document.querySelectorAll('#sessions-compose [data-intent][aria-pressed=true]')].map((node) => node.dataset.intent), send: document.getElementById('sessions-send').textContent.trim(), placeholder: document.getElementById('sessions-input').placeholder, attach: Boolean(document.querySelector('#sessions-compose .composer-attach-button')), attachShown: (() => { const node = document.querySelector('#sessions-compose .composer-attach-button'); return Boolean(node) && getComputedStyle(node).display !== 'none' && node.getBoundingClientRect().width > 0; })(), picker: Boolean(window.MefiComposerPicker.get(document.getElementById('sessions-input'))), pictures: Boolean(window.MefiComposerPictures.get(document.getElementById('sessions-input'))) };");
  const first = await box();
  assert.equal(first.intent, "ask", "a task with a worker on it starts as an Ask");
  assert.deepEqual([first.send, first.attachShown, first.picker, first.pictures], ["Ask", true, true, true], "the picture button and the @ # / picker are bound to this box");
  await click("#sessions-intent-note");
  const note = await box();
  assert.deepEqual([note.intent, note.pressed, note.send, note.attachShown], ["note", ["note"], "Save note", true], "Attach is on the row for every purpose, as in the prototype (a Note's pictures wait for an Ask or a Change)");
  await forget();
  await run("const input = document.getElementById('sessions-input'); input.value = 'Prefer rounded corners'; input.dispatchEvent(new Event('input', { bubbles: true }));");
  await click("#sessions-send");
  await until("window.sessionsFixture.calls().some((call) => call.name === 'tasksSave')", "the note is saved");
  const saved = (await callsOf(["tasksSave"]))[0].args[0][0];
  assert.match(saved.notes, /- Prefer rounded corners$/); assert.equal(saved.logs.at(-1).kind, "note");
  await until("document.getElementById('sessions-input').value === ''", "the box is emptied once the note went");
  // A draft belongs to its task and its purpose.
  await run("const input = document.getElementById('sessions-input'); input.value = 'half a thought'; input.dispatchEvent(new Event('input', { bubbles: true }));");
  await click("#sessions-intent-ask");
  assert.equal(await run("return document.getElementById('sessions-input').value;"), "", "the Ask box starts empty");
  await click("#sessions-intent-note");
  assert.equal(await run("return document.getElementById('sessions-input').value;"), "half a thought", "the draft is still there when you come back");
  await run("const input = document.getElementById('sessions-input'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));");
  await click("#sessions-intent-ask");
  await forget();
  await run("const input = document.getElementById('sessions-input'); input.value = 'Does it handle search?'; input.dispatchEvent(new Event('input', { bubbles: true }));");
  await focusOn("#sessions-input"); await press("Enter");
  await until("window.sessionsFixture.calls().some((call) => call.name === 'assistantMessage')", "Enter sends an Ask");
  const asked = (await callsOf(["assistantMessage"]))[0].args;
  assert.equal(asked[0], 'About the task "Add an empty state to the notes list" (task_ask): Does it handle search?');
  assert.deepEqual(asked[2], { view: "Studio · task", companion: "Mefi", taskId: "task_ask" });
  await until("[...document.querySelectorAll('#sessions-thread .sx-item.is-ask')].some((node) => node.textContent.includes('Yes: that matches.'))", "the question and Mefi's answer show in the thread");
  await click("#sessions-intent-change");
  await forget();
  await run("const input = document.getElementById('sessions-input'); input.value = 'Also show a tip'; input.dispatchEvent(new Event('input', { bubbles: true }));");
  await click("#sessions-send");
  await until("window.sessionsFixture.calls().some((call) => call.name === 'tasksCreate')", "a Change creates a linked follow-up");
  const follow = (await callsOf(["tasksCreate"]))[0].args[0];
  assert.match(follow.title, /^Change: Also show a tip/); assert.match(follow.prompt, /Follow-up to task "Add an empty state to the notes list" \(task_ask\)/);
  step("the box sends a Note, an Ask and a Change");
  // @ opens the picker over this box.
  await click("#sessions-intent-note");
  await run("const input = document.getElementById('sessions-input'); input.focus(); input.value = 'see @Tool'; input.setSelectionRange(9, 9); input.dispatchEvent(new Event('input', { bubbles: true }));");
  await until("document.querySelector('.composer-picker:not([hidden]) .composer-picker-item')", "typing @ offers the project's files");
  await press("Escape");
  await run("const input = document.getElementById('sessions-input'); input.value = ''; input.dispatchEvent(new Event('input', { bubbles: true }));");
  step("the picker opens in this box");

  // ---- a finished attempt with changes: the inspector ----------------------------------------------------------------------------------
  await open("task_review", "Markdown");
  await until("document.querySelector('#sessions-itab-changes em')?.textContent === '4'", "the Changes tab counts the files");
  assert.equal(await run("return document.getElementById('sessions-itab-changes').getAttribute('aria-selected');"), "true", "a task with changes opens on Changes");
  assert.equal(await textOf("#sessions-itab-checks em"), "2/3", "Checks counts what passed");
  await until("document.querySelector('#sessions-pane-changes .review-file')", "review.js draws the changed files");
  assert.equal(await count("#sessions-pane-changes .review-file"), 4);
  assert.match(await textOf("#sessions-pane-changes .review-totals"), /4 files changed/);
  // Tab keys.
  await focusOn("#sessions-itab-changes");
  await press("Right"); assert.equal(await run("return document.activeElement.id;"), "sessions-itab-checks"); assert.equal(await run("return document.getElementById('sessions-pane-checks').hidden;"), false);
  await press("End"); assert.equal(await run("return document.activeElement.id;"), "sessions-itab-wt");
  await press("Home"); assert.equal(await run("return document.activeElement.id;"), "sessions-itab-plan");
  await click("#sessions-itab-changes");
  assert.equal(await run("return [...document.querySelectorAll('#sessions-inspector .sx-pane')].filter((node) => !node.hidden).map((node) => node.id);").then((value) => value.join()), "sessions-pane-changes", "only the tab that is chosen shows");
  await capture("sessions-changes-1440.png");

  // Accept, Revert with its second press, and Undo: review.js's panel, through the bridge.
  await forget();
  await clickText("#sessions-pane-changes button", "Accept changes");
  await until("[...document.querySelectorAll('#sessions-pane-changes .review-chip')].some((node) => node.textContent.includes('Accepted'))", "Accept is recorded");
  assert.equal((await callsOf(["tasksAccept"])).length, 1);
  assert.equal((await run("return window.sessionsFixture.state().changes.accepted;")), true);
  await clickText("#sessions-pane-changes button", "Undo accept");
  await until("[...document.querySelectorAll('#sessions-pane-changes button')].some((node) => node.textContent.trim() === 'Accept changes')", "Undo accept puts the button back");
  await forget();
  await clickText("#sessions-pane-changes button", "Revert attempt");
  await until("[...document.querySelectorAll('#sessions-pane-changes button')].some((node) => node.textContent.trim() === 'Revert all 4')", "the first press asks");
  assert.equal((await callsOf(["tasksRevert"])).length, 0, "one press changes nothing");
  await clickText("#sessions-pane-changes button", "Revert all 4");
  await until("window.sessionsFixture.state().changes.reverted === true", "the second press reverts");
  await until("[...document.querySelectorAll('#sessions-pane-changes button')].some((node) => node.textContent.includes('Undo the revert'))", "the revert offers its Undo");
  assert.equal((await callsOf(["tasksRevert"])).length, 1);
  await clickText("#sessions-pane-changes button", "Undo the revert");
  await until("window.sessionsFixture.state().changes.reverted === false", "Undo puts the files back");
  assert.equal((await callsOf(["tasksRevert"])).at(-1).args[0].undo, "R20260930", "Undo names the receipt the revert gave");
  await until("document.querySelector('#sessions-itab-changes em')?.textContent === '4'", "the count is back");
  step("Accept, Revert and Undo work through the bridge");

  // The other tabs.
  await click("#sessions-itab-checks");
  await until("document.querySelector('#sessions-pane-checks .review-check')", "the advisory checks arrive");
  const checks = await textOf("#sessions-pane-checks");
  assert.match(checks, /Done when/); assert.match(checks, /One \.md file per note/); assert.match(checks, /Last check run/); assert.match(checks, /Typecheck/); assert.match(checks, /Advisory/);
  await click("#sessions-itab-preview");
  await until("document.querySelectorAll('#sessions-pane-preview .review-shot-image').length === 2", "the before and after shots arrive");
  assert.match(await textOf("#sessions-pane-preview"), /Preview ready/);
  assert.ok(await run("return [...document.querySelectorAll('#sessions-pane-preview button')].some((node) => node.textContent.trim() === 'Open app');"), "Open app is the existing path to the running preview");
  await forget();
  await clickText("#sessions-pane-preview button", "Open app");
  await until("window.sessionsFixture.calls().some((call) => call.name === 'projectPreviewOpen')", "Open app asks the host to open the preview");
  await click("#sessions-itab-agent");
  await until("document.querySelector('#sessions-pane-agent .sx-stepper')", "the agent's usage and limit arrive");
  const agent = await textOf("#sessions-pane-agent");
  assert.match(agent, /Claude Code/); assert.match(agent, /Not reported/); assert.match(agent, /Stop an attempt after/); assert.match(agent, /25 min/);
  await forget();
  await clickText("#sessions-pane-agent .sx-stepper button", "+");
  await until("window.sessionsFixture.calls().some((call) => call.name === 'tasksCap')", "the limit goes to the host");
  assert.equal((await callsOf(["tasksCap"]))[0].args[0].minutes, 30);
  await click("#sessions-itab-plan");
  assert.match(await textOf("#sessions-pane-plan"), /Steps/); assert.match(await textOf("#sessions-pane-plan"), /Acceptance checks/); assert.match(await textOf("#sessions-pane-plan"), /One \.md file per note/);
  step("Plan, Checks, Preview and Agent show the task's facts");
  // The Worktree tab: a run in its own checkout, in Work › Worktrees' words.
  await open("task_run", "tag");
  await click("#sessions-itab-wt");
  await until("/Only on this PC/.test(document.getElementById('sessions-pane-wt')?.textContent || '')", "the Worktree tab says where the run works and whether its work is safe");
  assert.match(await textOf("#sessions-pane-wt"), /mefi\/tag-search/); assert.match(await textOf("#sessions-pane-wt"), /2 commits/);
  assert.equal(await run("return document.getElementById('sessions-itab-wt').hidden;"), false, "the tab on screen is on the row, whatever the width");
  await capture("sessions-worktree-1440.png");
  await click("#sessions-itab-plan");
  // Home with no session: the project's inspector. A page that is not a session: no inspector at all.
  await run("window.MefiNav.go('workspace');");
  await until("window.MefiSessions.selected() === null && !document.getElementById('sessions-project-insp').hidden && /Repository/.test(document.getElementById('sessions-project-insp').textContent) && /Live activity/.test(document.getElementById('sessions-project-insp').textContent)", "Home with no session shows the project's inspector");
  assert.match(await textOf("#sessions-project-insp"), /3 of 3 busy/);
  await capture("sessions-project-1440.png");
  await run("window.MefiNav.go('tasks');");
  await until("window.MefiShell.info('inspector').vacant === true && document.getElementById('shell-inspector').hidden && window.MefiNav.layout.used('inspector') === 0", "a page that is not a session folds the inspector away");
  await run("window.MefiNav.go('workspace');");
  await until("!document.getElementById('shell-inspector').hidden && window.MefiNav.layout.used('inspector') > 0", "and Home brings it back");
  step("the Worktree tab, the project's inspector, and no inspector on other pages");

  // ---- media in the thread ------------------------------------------------------------------------------------------------------------------
  await open("task_review", "Markdown");
  await until("document.querySelectorAll('#sessions-thread .sx-compare img').length === 2", "the before and after shots reach the thread");
  await until("[...document.querySelectorAll('#sessions-thread .sx-compare img')].every((img) => img.naturalWidth === 1280)", "both shots decode");
  await run("document.getElementById('sessions-thread-scroll').querySelector('.sx-media').scrollIntoView({ block: 'center' });"); await sleep(250);
  const media = await run("const scroll = document.getElementById('sessions-thread-scroll').getBoundingClientRect(); const box = document.querySelector('#sessions-thread .sx-compare').getBoundingClientRect(); const imgs = [...document.querySelectorAll('#sessions-thread .sx-compare img')].map((img) => getComputedStyle(img).objectFit + ':' + img.getBoundingClientRect().width); return { box: [box.left, box.top, box.right, box.bottom, box.width, box.height], scroll: [scroll.left, scroll.top, scroll.right, scroll.bottom], imgs, ratio: box.width / box.height };");
  assert.ok(media.box[0] >= media.scroll[0] - 1 && media.box[2] <= media.scroll[2] + 1, `the compare frame is inside the thread, not cut at its sides: ${JSON.stringify(media)}`);
  assert.ok(media.box[4] > 200 && media.box[5] > 100, `and has a size: ${JSON.stringify(media.box)}`);
  assert.ok(media.imgs.every((item) => item.startsWith("contain:")), "both shots are fitted whole");
  await capture("sessions-media-1440.png");
  await focusOn("#sessions-thread .sx-media .sx-link"); await press("Enter");
  await until("document.getElementById('sessions-lightbox')", "Open larger opens the lightbox");
  await sleep(300);
  const lightbox = await run("const img = document.querySelector('#sessions-lightbox .sx-lb-img'); const r = img.getBoundingClientRect(); return { natural: [img.naturalWidth, img.naturalHeight], box: [r.left, r.top, r.right, r.bottom, r.width, r.height], win: [innerWidth, innerHeight], tabs: [...document.querySelectorAll('#sessions-lightbox .sx-lb-tabs button')].map((node) => node.textContent.trim() + ':' + node.getAttribute('aria-pressed')), focus: document.activeElement.className, dialog: document.getElementById('sessions-lightbox').getAttribute('role') + ':' + document.getElementById('sessions-lightbox').getAttribute('aria-modal') };");
  assert.deepEqual(lightbox.natural, [1280, 800]); assert.deepEqual(lightbox.tabs, ["Before:true", "After:false"]); assert.equal(lightbox.dialog, "dialog:true");
  assert.ok(lightbox.box[0] >= 0 && lightbox.box[1] >= 0 && lightbox.box[2] <= lightbox.win[0] && lightbox.box[3] <= lightbox.win[1], `the whole shot fits the window: ${JSON.stringify(lightbox)}`);
  assert.ok(Math.abs(lightbox.box[4] / lightbox.box[5] - 1.6) < 0.02, `and keeps its shape: ${JSON.stringify(lightbox.box)}`);
  assert.match(lightbox.focus, /sx-lb-close/, "focus moves into the dialog");
  await capture("sessions-lightbox-1440.png");
  await size(600, 560);
  const small = await run("const img = document.querySelector('#sessions-lightbox .sx-lb-img'); const r = img.getBoundingClientRect(); return { box: [r.left, r.top, r.right, r.bottom, r.width, r.height], win: [innerWidth, innerHeight] };");
  assert.ok(small.box[0] >= 0 && small.box[1] >= 0 && small.box[2] <= small.win[0] && small.box[3] <= small.win[1] && Math.abs(small.box[4] / small.box[5] - 1.6) < 0.02, `a shot bigger than the window is scaled down to fit it, whole: ${JSON.stringify(small)}`);
  await size(1440, 900);
  await press("Right");
  assert.equal(await run("return [...document.querySelectorAll('#sessions-lightbox .sx-lb-tabs button')].map((node) => node.getAttribute('aria-pressed')).join();"), "false,true", "an arrow key moves to the After shot");
  await press("Tab"); await press("Tab"); await press("Tab");
  assert.ok(await run("return document.getElementById('sessions-lightbox').contains(document.activeElement);"), "Tab stays inside the dialog");
  await press("Escape");
  await until("!document.getElementById('sessions-lightbox')", "Escape closes it");
  assert.match(await run("return document.activeElement.textContent.trim();"), /Open larger/, "and focus goes back to what opened it");
  // A picture in a message: the tall one, whole.
  await run("document.querySelector('#sessions-thread .is-ask .sx-thumb, #sessions-thread .sx-thumb').scrollIntoView({ block: 'center' });"); await sleep(250);
  await run("document.querySelector('#sessions-thread .sx-thumb').click();");
  await until("document.getElementById('sessions-lightbox')", "a picture opens in the lightbox");
  await sleep(300);
  const tall = await run("const img = document.querySelector('#sessions-lightbox .sx-lb-img'); const r = img.getBoundingClientRect(); return { natural: [img.naturalWidth, img.naturalHeight], box: [r.left, r.top, r.right, r.bottom, r.width, r.height], win: [innerWidth, innerHeight], tabs: document.querySelectorAll('#sessions-lightbox .sx-lb-tabs button').length };");
  assert.deepEqual(tall.natural, [360, 720]); assert.equal(tall.tabs, 0, "a single picture has no Before and After switch");
  assert.ok(tall.box[1] >= 0 && tall.box[3] <= tall.win[1] && Math.abs(tall.box[4] / tall.box[5] - 0.5) < 0.02, `a tall picture is shown whole inside the window: ${JSON.stringify(tall)}`);
  await click("#sessions-lightbox .sx-lb-scrim");
  await until("!document.getElementById('sessions-lightbox')", "a click outside closes it");
  step("media in the thread is whole and opens in the lightbox");

  // ---- failure, review and done states ---------------------------------------------------------------------------------------------------
  await open("task_failed", "first paint");
  await until("document.querySelector('#sessions-thread .sx-banner[data-tone=bad]')", "a failed check shows its banner");
  assert.match(await textOf("#sessions-thread .sx-banner[data-tone=bad]"), /first-paint budget/);
  assert.ok(await run("return [...document.querySelectorAll('#sessions-head .sx-actions button')].some((node) => node.textContent.trim() === 'Try again');"), "and the way on");
  await open("task_review", "Markdown");
  assert.match(await textOf("#sessions-thread .sx-banner[data-tone=info]"), /Checking the result/);
  assert.ok(await run("return [...document.querySelectorAll('#sessions-thread .sx-banner button')].map((node) => node.textContent.trim()).join('|');").then((value) => /See the changes\|Request changes\|Approve and finish/.test(value)), "the review banner offers the changes, a change and approval");
  await clickText("#sessions-thread .sx-banner button", "Request changes");
  assert.equal(await run("return document.getElementById('sessions-compose').dataset.intent;"), "change", "Request changes opens the Change box");
  await click("#sessions-itab-plan");
  await clickText("#sessions-thread .sx-banner button", "See the changes");
  assert.equal(await run("return document.getElementById('sessions-itab-changes').getAttribute('aria-selected');"), "true", "See the changes shows the Changes tab");
  assert.ok(await count("#sessions-thread .sx-evidence") === 1 && /4 files changed/.test(await textOf("#sessions-thread .sx-evidence")), "the thread links to the evidence after the run");
  await open("task_done", "Rename the export button");
  await until("document.querySelector('#sessions-thread .sx-decided')", "the record of what Mefi decided shows");
  assert.match(await textOf("#sessions-thread .sx-decided"), /Mefi decided.*Keep the old name as an alias/);
  assert.match(await textOf("#sessions-thread .sx-banner[data-tone=good]"), /Verified/);
  await forget();
  await clickText("#sessions-thread .sx-decided button", "Undo");
  await until("window.sessionsFixture.calls().some((call) => call.name === 'autonomyUndo')", "Undo takes back what Mefi decided");
  assert.equal((await callsOf(["autonomyUndo"]))[0].args[0].id, "dec_1");
  step("failure, review and done states read right");

  // ---- opening from anywhere ---------------------------------------------------------------------------------------------------------------
  assert.equal(await run(`return window.MefiSessions.redirect('tasks', { taskId: 'task_run2', board: true });`), null, "the task board stays one press away");
  assert.deepEqual(await run(`return window.MefiSessions.redirect('tasks', { taskId: 'task_run2', projectId: ${q(projectId)} });`), { id: "workspace", params: { view: "task", taskId: "task_run2", projectId } });
  await run(`window.MefiNav.go('tasks', { taskId: 'task_run2', projectId: ${q(projectId)}, filter: 'all' });`);
  await until("window.MefiSessions.selected() === 'task_run2' && document.querySelector('#sessions-head .sx-title')?.textContent.includes('Keyboard shortcut')", "nav.go('tasks', { taskId }) (a notification, the palette) lands in the thread");
  assert.ok(await run("return document.querySelector('#sessions-list .sx-row[data-key=task_run2]').hasAttribute('data-selected') && document.querySelector('#sessions-list .sx-row[data-key=task_run2] .sx-row-main').getAttribute('aria-current') === 'true';"), "and selects it in the list");
  await run(`window.MefiNav.go('workspace', { view: 'task', taskId: 'task_queued', projectId: ${q(projectId)} });`);
  await until("window.MefiSessions.selected() === 'task_queued'", "a tab's route selects its session");
  await run("window.MefiNav.go('workspace');");
  await until("window.MefiSessions.selected() === null && document.getElementById('sessions-thread').hidden", "Home by itself puts the thread away");
  assert.equal(await run("return document.getElementById('workspace-layer').hasAttribute('inert');"), false, "and uncovers Home");
  await click("#sessions-new");
  assert.equal(await run("return window.MefiSessions.selected();"), null);
  await run("document.querySelector('#sessions-list .sx-row[data-key=task_done] .sx-row-main').click();");
  await until("window.MefiSessions.selected() === 'task_done'", "a click selects");
  assert.equal(await run("return document.getElementById('workspace-layer').hasAttribute('inert');"), true, "Home is covered (out of the tab order, no scroll fades over the thread) while a session shows");
  await press("N", ["control"]);
  await until("window.MefiSessions.selected() === null", "Ctrl N starts a new task from anywhere");
  step("a session opens from a tab, a notification and a click, and Ctrl N starts a new task");

  // ---- from Vibe's Today ----------------------------------------------------------------------------------------------------------------
  // Vibe's Home is Today. A card, or a notification, opens its task as a session: the thread over Today, in a tab of its own (the window's
  // own modules meet here: Today asks the session panels, which ask the tab strip, which asks the router).
  await run("await window.MefiVibe.setMode('vibe');");
  await until("window.MefiToday && window.MefiToday.isOn() && document.getElementById('vibe-layer') && !document.getElementById('vibe-layer').hidden", "Today is up in Vibe");
  assert.equal(await run("return window.MefiSessions.selected();"), null, "Today starts with no session open");
  assert.equal(await run(`return window.MefiToday.openFromAlert({ kind: 'fail', id: 'task_failed', taskId: 'task_failed', projectId: ${q(projectId)}, count: 1 });`), true, "a notification for one task opens it");
  await until("window.MefiSessions.selected() === 'task_failed' && !document.getElementById('sessions-thread').hidden && document.querySelector('#sessions-head .sx-title')?.textContent.includes('first paint')", "Today's task opens as a session, in its thread");
  if (await run("return Boolean(window.MefiTabs && window.MefiTabs.list);")) {
    const tab = await run("return window.MefiTabs.list().find((item) => item.route.id === 'workspace' && item.route.params.view === 'task' && item.route.params.taskId === 'task_failed') || null;");
    assert.ok(tab && tab.active, `the session has a tab of its own, and it is the one showing: ${JSON.stringify(tab)}`);
    assert.equal(await run("return window.MefiTabs.list().some((item) => item.route.id === 'tasks');"), false, "and no tab for the Task board, which could not say which task it was asked for");
  }
  assert.equal(await run("return document.getElementById('vibe-layer').hasAttribute('inert');"), true, "Today is covered while the thread shows");
  assert.equal(await run("const r = document.getElementById('sessions-thread').getBoundingClientRect(); const node = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return Boolean(node && node.closest('#sessions-thread'));"), true, "and the thread, not Today, is what a press lands on");
  await capture("sessions-from-today-1440.png");
  // Home again puts the thread away and uncovers Today.
  await run("window.MefiNav.go('workspace', { view: 'home' });");
  await until("window.MefiSessions.selected() === null && document.getElementById('sessions-thread').hidden && !document.getElementById('vibe-layer').hasAttribute('inert')", "Home puts the thread away and uncovers Today");
  // Back to Build the way this test began it (a mode change re-reads the rail's pin, which would open the rail and take the room the sizes below measure).
  await run("await window.MefiVibe.setMode('build', { go: false }); window.MefiNav.applyShell(true); window.MefiNav.setRailPinned(false, { save: false }); window.MefiNav.go('workspace');");
  await until("document.body.classList.contains('workspace-active') && !document.getElementById('workspace-layer').hasAttribute('inert')", "Build's Home is back");
  step("Vibe's Today opens a task as a session in its own tab, and Home puts the thread away");

  // ---- sizes --------------------------------------------------------------------------------------------------------------------------------
  // The five of the window's contract, and a wide one that is short (the box folds for the height alone, not the width).
  const sizes = [[1920, 1080, 1], [1440, 900, 1], [1100, 720, 1], [600, 560, 1], [600, 560, 1.5], [1920, 480, 1]];
  for (const [width, height, zoom] of sizes) {
    const label = `${width}x${height}@${zoom}`;
    await size(width, height, zoom);
    // Columns dock when the window has room for them (and are opened if an earlier size closed them); a folded one is a drawer, put away here.
    await run("for (const name of ['list', 'inspector']) { const info = window.MefiShell.info(name); if (info && info.drawer) window.MefiShell.close(name); else window.MefiShell.open(name); }");
    await sleep(250);
    for (const [id, part] of [["task_ask", "empty state"], ["task_review", "Markdown"]]) {
      await run(`window.MefiSessions.select(${q(id)});`);
      await until(`document.querySelector('#sessions-head .sx-title')?.textContent.includes(${q(part)}) && !document.getElementById('sessions-thread').hidden`, `${id} shows at ${label}`);
      await sleep(500);
      const folded = await run("return (document.documentElement.dataset.layoutFold || '').length > 0;");
      const m = await run(measure);
      await capture(`sessions-${id === "task_ask" ? "ask" : "review"}-${width}${height < 520 ? "-short" : ""}${zoom === 1 ? "" : "-zoom"}.png`);
      report.layouts.push({ label, id, folded, thread: m.thread, list: m.list, inspector: m.inspector });
      assert.equal(m.pageOverflow, false, `${label}: the page does not overflow`);
      assert.equal(m.scrollbarWidth, "none", `${label}: native bars stay hidden`);
      assert.deepEqual(m.small, [], `${label}: no text under 12 px: ${JSON.stringify(m.small)}`);
      assert.deepEqual(m.scrollers.filter((item) => item.reserved > 0.75 || item.reservedY > 0.75), [], `${label}: no scroller reserves width for a bar: ${JSON.stringify(m.scrollers)}`);
      assert.deepEqual(m.wide, [], `${label}: no panel is wider than its box`);
      assert.deepEqual(m.spill, [], `${label}: nothing sticks out past its panel: ${JSON.stringify(m.spill)}`);
      assert.ok(m.thread && m.thread.w > 280 && m.thread.h > 200, `${label}: the thread has a size: ${JSON.stringify(m.thread)}`);
      assert.ok(m.thread.r <= m.inner.w + 1 && m.thread.b <= m.inner.h + 1, `${label}: the thread stays in the window`);
      assert.ok(m.compose && m.compose.w > 200 && m.compose.b <= m.inner.h + 1 && m.send && m.send.b <= m.inner.h + 1 && m.send.r <= m.inner.w + 1, `${label}: the whole box, Send included, is on screen: ${JSON.stringify([m.compose, m.send])}`);
      assert.ok(m.scroll && m.scroll.h >= 60, `${label}: the thread keeps room to be read (${m.scroll && m.scroll.h} px)`);
      assert.ok(!m.dock || m.dock.h <= m.inner.h * 0.56, `${label}: the question does not crowd the thread out`);
      if (!folded) {
        assert.ok(m.list && m.list.w > 200 && m.list.r <= m.inner.w, `${label}: the list has its column: ${JSON.stringify(m.list)}`);
        assert.ok(m.inspector && m.inspector.w > 200 && m.inspector.r <= m.inner.w + 1, `${label}: the inspector has its column: ${JSON.stringify(m.inspector)}`);
        assert.ok(m.thread.x >= m.list.r - 1 && m.thread.r <= m.inspector.x + 1, `${label}: the thread sits between them`);
        assert.ok(m.itabs && m.itabs.h <= 90, `${label}: the tabs take one or two rows`);
      }
      if (id === "task_review") {
        assert.ok(await run("const box = document.querySelector('#sessions-thread .sx-compare'); return Boolean(box) && box.getBoundingClientRect().width > 100;"), `${label}: the before and after frame has a size`);
      }
      // A short window (under 520 CSS px) or a narrow thread (up to 620) folds the box: the words and Send, the rest behind More.
      const boxState = `const form = document.getElementById('sessions-compose'); const shown = (selector) => { const node = form.querySelector(selector); if (!node) return null; const r = node.getBoundingClientRect(); return getComputedStyle(node).display !== 'none' && r.width > 0 && r.height > 0; };
        return { open: form.dataset.open, hint: shown('.sx-hint'), more: shown('.sx-more'), chips: shown('#sessions-chips'), run: shown('#sessions-run'), modes: shown('.sx-modes'), autonomy: shown('#sessions-autonomy'), attach: shown('.composer-attach-button') };`;
      const short = m.inner.h < 520, narrow = m.thread.w <= 620, folds = short || narrow;
      const before = await run(boxState);
      assert.equal(before.more, folds, `${label}: More shows exactly when the box is folded: ${JSON.stringify(before)}`);
      assert.equal(before.chips, !folds, `${label}: the Worktree switch is folded away with it: ${JSON.stringify(before)}`);
      assert.equal(before.run, !folds, `${label}: and the run menu's button: ${JSON.stringify(before)}`);
      assert.equal(before.autonomy, false, `${label}: the permission mode waits in the run menu: ${JSON.stringify(before)}`);
      assert.equal(before.hint, !folds, `${label}: and the line that says what the words will do: ${JSON.stringify(before)}`);
      if (short) assert.equal(before.modes, false, `${label}: a short window hides the Note | Ask | Change switch too: ${JSON.stringify(before)}`);
      if (!folds && id === "task_ask") {
        await click("#sessions-run");
        await until("!document.getElementById('sessions-run-menu').hidden", `${label}: the run menu opens`);
        const r = await run("const m = document.getElementById('sessions-run-menu').getBoundingClientRect(), t = document.getElementById('sessions-thread').getBoundingClientRect(); const shown = (id) => { const n = document.getElementById(id); return Boolean(n) && n.getClientRects().length > 0 && getComputedStyle(n).display !== 'none'; }; return { inside: m.top >= t.top - 1 && m.bottom <= t.bottom + 1 && m.left >= t.left - 1 && m.right <= innerWidth + 1, box: [Math.round(m.left), Math.round(m.top), Math.round(m.right), Math.round(m.bottom)], thread: [Math.round(t.top), Math.round(t.bottom)], modes: document.querySelectorAll('#sessions-run-menu .autonomy-mode').length, cli: shown('sessions-worker-cli'), tier: shown('sessions-worker-tier'), folder: shown('sessions-branch') };");
        assert.ok(r.inside, `${label}: the run menu stays inside the thread: ${JSON.stringify(r)}`);
        assert.ok(r.modes >= 1 && r.cli && r.tier && r.folder, `${label}: it holds the permission mode, the worker, its tier and the folder: ${JSON.stringify(r)}`);
        const inMenu = await run(measure);
        assert.deepEqual(inMenu.small, [], `${label}: no text under 12 px in the run menu: ${JSON.stringify(inMenu.small)}`);
        if (width === 1920) await capture("sessions-runmenu-1920.png");
        await press("Escape");
        await until("document.getElementById('sessions-run-menu').hidden", `${label}: Escape closes the run menu`);
      }
      if (folds) {
        await run("const input=document.getElementById('sessions-input');input.value='Keep this draft while session controls are open.';input.dispatchEvent(new Event('input', { bubbles: true }));");
        await click("#sessions-compose .sx-more");
        const opened = await run(boxState);
        assert.equal(opened.open, "true"); assert.equal(opened.chips, true, `${label}: More brings the chips back: ${JSON.stringify(opened)}`); assert.equal(opened.run, true);
        assert.equal(opened.modes, true, `${label}: and the purposes: ${JSON.stringify(opened)}`);
        await capture(`sessions-more-${id === "task_ask" ? "ask" : "review"}-${width}${height < 520 ? "-short" : ""}${zoom === 1 ? "" : "-zoom"}.png`);
        const inside = await run("const form = document.getElementById('sessions-compose').getBoundingClientRect(); const send = document.getElementById('sessions-send').getBoundingClientRect(); const bar = document.querySelector('.shell-status')?.getBoundingClientRect(); const free = bar ? bar.top : innerHeight; return { ok: form.bottom <= free + 1 && send.bottom <= free + 1 && form.top >= 0, form: [Math.round(form.top), Math.round(form.bottom)], send: [Math.round(send.top), Math.round(send.bottom)], free, inner: innerHeight };");
        assert.equal(inside.ok, true, `${label}: opened, the whole box is still on screen and clear of the status bar: ${JSON.stringify(inside)}`);
        const readable = await run("const scroll=document.getElementById('sessions-thread-scroll');return { height:scroll.clientHeight, overflow:scroll.scrollHeight>scroll.clientHeight, draft:document.getElementById('sessions-input').value };");
        (report.expandedLayouts ||= []).push({ label, id, ...readable });
        assert.ok(readable.height>=60, `${label}: expanded controls retain at least 60px of conversation: ${JSON.stringify(readable)}`);
        assert.equal(readable.draft, 'Keep this draft while session controls are open.');
        await click("#sessions-compose .sx-more");
        assert.equal((await run(boxState)).chips, false, `${label}: and More folds it again`);
      }
    }
    if (report.layouts.at(-1).folded) {
      // A folded window (under 900 CSS px) has no columns: the list and the inspector are drawers, and each fits the window when opened.
      for (const region of ["list", "inspector"]) {
        await run(`window.MefiShell.open(${q(region)});`);
        await sleep(300);
        const d = await run(measure);
        const panel = region === "list" ? d.list : d.inspector;
        assert.ok(panel && panel.w > 150 && panel.r <= d.inner.w + 1 && panel.b <= d.inner.h + 1, `${label}: the ${region} drawer fits the window: ${JSON.stringify(panel)}`);
        assert.deepEqual(d.small, [], `${label}: no text under 12 px in the ${region} drawer`);
        assert.deepEqual(d.scrollers.filter((item) => item.reserved > 0.75 || item.reservedY > 0.75), [], `${label}: no scroller reserves width in the ${region} drawer`);
        assert.deepEqual(d.spill, [], `${label}: nothing sticks out of the ${region} drawer: ${JSON.stringify(d.spill)}`);
        await capture(`sessions-${region}-drawer-${width}${zoom === 1 ? "" : "-zoom"}.png`);
        await run(`window.MefiShell.close(${q(region)});`);
      }
    }
  }
  assert.equal(report.layouts.length, 12, "two sessions at six sizes");
  step("every panel fits six window sizes");
  // ---- the Work view at 1920x1080, beside the prototype's shots (docs/prototype/) ------------------------------------------------------------
  await size(1920, 1080, 1);
  await run("for (const name of ['list', 'inspector']) window.MefiShell.open(name);");
  const gallery = async (name, setup, ready) => { await run(setup); await until(ready, name); await sleep(450); await capture(name); };
  await gallery("work-1920-plan.png", "window.MefiSessions.select('task_ask'); window.MefiSessions.setTab('plan');", "document.querySelector('#sessions-head .sx-title')?.textContent.includes('empty state') && !document.getElementById('sessions-pane-plan').hidden");
  await gallery("work-1920-worktree.png", "window.MefiSessions.select('task_run'); window.MefiSessions.setTab('wt');", "/Only on this PC/.test(document.getElementById('sessions-pane-wt')?.textContent || '')");
  await gallery("work-1920-agent.png", "window.MefiSessions.setTab('agent');", "document.querySelector('#sessions-pane-agent .sx-icard') && !document.getElementById('sessions-pane-agent').hidden");
  await run("window.MefiSessions.setTab('plan');");
  await gallery("work-1920-project.png", "window.MefiNav.go('workspace');", "window.MefiSessions.selected() === null && !document.getElementById('sessions-project-insp').hidden");
  await gallery("work-1920-backlog.png", "document.getElementById('sessions-tab-backlog').click();", "document.querySelector('#sessions-list .sx-scan')");
  await run("document.getElementById('sessions-tab-sessions').click();");
  await gallery("work-1920-project-menu.png", "document.getElementById('sessions-project').click();", "document.getElementById('sessions-project-menu')");
  await press("Escape");
  await gallery("work-1920-worktrees-page.png", "window.MefiNav.go('worktrees');", "!document.getElementById('shell-pages').hidden && document.getElementById('shell-inspector').hidden");
  await run("window.MefiNav.go('workspace');");
  await until("!document.getElementById('shell-inspector').hidden", "back on Home");
  step("the Work view at 1920x1080");
  await size(1440, 900, 1);

  // ---- switching it off, and on again ---------------------------------------------------------------------------------------------------------
  assert.equal(await run("return window.MefiSessions.setEnabled(false);"), false);
  assert.equal(await count(".sx-panel"), 0, "the kill switch puts the panels away at once");
  assert.equal(await run("return document.getElementById('workspace-layer').hasAttribute('inert') || document.getElementById('vibe-layer').hasAttribute('inert');"), false, "and uncovers Home");
  assert.equal(await run("return window.localStorage.getItem('mefiStudio.sessions');"), "off", "and keeps it off");
  assert.equal(await run("return window.MefiSessions.attach();"), false, "attach does nothing while it is off");
  assert.equal(await run("return window.MefiSessions.redirect('tasks', { taskId: 'task_run' });"), null, "nor does a link");
  assert.equal(await run("return window.MefiSessions.setEnabled(true);"), true);
  await until("document.querySelectorAll('.sx-panel').length === 3", "switching it on brings the panels back");
  await until("document.querySelectorAll('#sessions-list .sx-row').length >= 9", "with the board");
  step("off and on again");

  // ---- a launch that says ?sessions=off, and one that restores the session ------------------------------------------------------------------
  await run("window.MefiSessions.select('task_run2'); window.MefiNav.saveResume();");
  await sleep(300);
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1", layout: "v2" } });
  await until("window.MefiNav && window.MefiWorkspace && window.MefiSessions && !window.MefiBoot?.isActive?.()", "studio ready again");
  await until("window.MefiShell && window.MefiShell.active()", "the shell's frame is up again");
  await run("window.MefiVibe.setMode('build', { go: false }); window.MefiNav.applyShell(true);");
  // The resume (nav.js resumeReady) enters Home directly, with no route: what remembers the session is this module's own memory.
  await run("await window.MefiWorkspace.enter();");
  await until("window.MefiSessions.active() && document.querySelectorAll('#sessions-list .sx-row').length >= 9", "the panels are back after a reload");
  await until("window.MefiSessions.selected() === 'task_run2'", "the session that was open is open again");
  await until("document.body.classList.contains('workspace-active') && !document.getElementById('sessions-thread').hidden && document.querySelector('#sessions-head .sx-title')?.textContent.includes('Keyboard shortcut')", "and the thread shows it");
  await capture("sessions-restored-1440.png");
  step("the selected session survives a reload");
  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1", layout: "v2", sessions: "off" } });
  await until("window.MefiNav && window.MefiWorkspace && window.MefiSessions && !window.MefiBoot?.isActive?.()", "studio ready with ?sessions=off");
  await until("window.MefiShell && window.MefiShell.active()", "the shell's frame is up again");
  await sleep(800);
  assert.equal(await run("return window.MefiSessions.enabled();"), false);
  assert.equal(await run("return window.MefiSessions.active();"), false, "?sessions=off leaves the panels out even with the shell there");
  assert.equal(await count(".sx-panel"), 0);
  step("?sessions=off is honoured");

  assert.deepEqual(report.errors, [], "no console errors");
  report.complete = true;
  finish();
}).catch(finish);
