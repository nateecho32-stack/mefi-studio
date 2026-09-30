"use strict";

// The review section (renderer/review.js) in a real renderer: a copied booklet, the real tasks.js and
// studio-ui.js around it, and a synthetic bridge that answers the host's tasks:changes, diff, accept,
// revert, checks, check-run, evidence and review:prefs from memory. Only copied renderer files and
// synthetic bridge answers are loaded; the real app entry point, stores, providers and workers stay absent.
const { app, BrowserWindow, session } = require("electron");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const { fileURLToPath } = require("node:url");
const root = process.env.MEFI_REVIEW_FIXTURE;
if (!root || !path.isAbsolute(root)) throw new Error("An isolated review fixture directory is required");
const report = { errors: [], networkAttempts: [], processAttempts: [], layouts: [] };
app.setName("Studio Review Fixture");
for (const name of ["userData", "sessionData", "crashDumps"]) {
  const directory = path.join(root, name); fs.mkdirSync(directory, { recursive: true }); app.setPath(name, directory);
}
app.disableHardwareAcceleration();
const childProcess = require("node:child_process");
for (const method of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[method] = () => { report.processAttempts.push(method); throw new Error("Child processes are disabled in the review fixture"); };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let finished = false;
const finish = (error) => {
  if (finished) return; finished = true;
  if (error) report.failure = error.stack || String(error);
  fs.writeFileSync(path.join(root, "report.json"), JSON.stringify(report, null, 2));
  if (error) console.error(error.stack || error);
  app.exit(error ? 1 : 0);
};
process.on("uncaughtException", finish); process.on("unhandledRejection", finish);

// A real PNG (Chromium decodes it, so the data URL, the CSP and the layout are all exercised).
function png(width, height, shade) {
  const table = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes) => { let c = 0xffffffff; for (const byte of bytes) c = table[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const body = Buffer.concat([Buffer.from(type, "latin1"), data]); const out = Buffer.alloc(8 + data.length + 4); out.writeUInt32BE(data.length, 0); body.copy(out, 4); out.writeUInt32BE(crc(body), 8 + data.length); return out; };
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) { rows[y * (width * 3 + 1)] = 0; for (let x = 0; x < width; x += 1) { const at = y * (width * 3 + 1) + 1 + x * 3; rows[at] = (shade + x) % 256; rows[at + 1] = (shade * 2 + y) % 256; rows[at + 2] = 140; } }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", header), chunk("IDAT", zlib.deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
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
  const now = Date.now();
  const tasks = [
    { id: "built", title: "Add a sticky header to the notes page", prompt: "Make the header stay visible while the notes scroll.", status: "done", projectId: "fixture", createdAt: now - 900000, updatedAt: now - 60000, doneAt: now - 60000, verification: { state: "verified", reason: "3 files changed" }, lastAttempt: { runId: "run_1_1", at: now - 120000, result: { parts: { done: "Sticky header" } } } },
    { id: "idle", title: "An idea that no worker has touched", prompt: "Nothing ran.", status: "open", projectId: "fixture", createdAt: now - 800000, updatedAt: now - 800000 },
  ];
  const taskStates = tasks.map((row) => ({ id: row.id, stage: row.status === "done" ? "done" : "ready", reason: row.status === "done" ? "Completed" : "Ready when scheduling resumes" }));
  const responses = {
    eyesState: { ok: true, sessions: [], todos: [], changes: [], pngs: [] }, tasksList: { ok: true, projectId: "fixture", tasks }, ideasList: { ok: true, ideas: [] },
    planningList: { ok: true, projectId: "fixture", projectName: "Isolated review project", plans: [] },
    projectsList: { ok: true, activeId: "fixture", projects: [{ id: "fixture", name: "Isolated review project", path: root }] },
    prefsGet: { ok: true, prefs: { commandHome: false, taskFilter: "all", autoReference: false } },
    assistantState: { ok: true, state: { status: "paused", agents: [], messages: [], prefs: {}, work: [] } }, assistantStatus: { ok: true, status: { enabled: false, execute: false, running: [], history: [] } },
    eyesCheckpointsRead: { ok: true, checkpoints: {} }, eyesRequestsRead: { ok: true, requests: [] }, eyesBriefingRead: { ok: true, briefing: null }, eyesCollisions: { ok: true, collisions: [], presence: [] },
    backlogStatus: { ok: true, projectId: "fixture", counts: { done: 1, ready: 1 }, taskStates, next: [] },
    speedMeasurements: { ok: true, measurements: {} }, readCatalog: JSON.parse(fs.readFileSync(path.join(root, "data", "models.json"), "utf8")),
  };
  const shots = { before: `data:image/png;base64,${png(320, 200, 30).toString("base64")}`, after: `data:image/png;base64,${png(320, 200, 120).toString("base64")}` };
  const preload = path.join(root, "review-preload.cjs");
  fs.writeFileSync(preload, `
const { contextBridge } = require("electron");
const responses = ${JSON.stringify(responses)};
const shots = ${JSON.stringify(shots)};
const calls = [];
const listeners = [];
const live = { accepted: false, reverted: false, prefs: { snapshots: true, advisory: true, advisoryBuild: false, shots: true }, buildRan: false };
const file = (path, more = {}) => ({ path, dir: path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "", name: path.slice(path.lastIndexOf("/") + 1), oldPath: null, status: "modified", additions: 4, deletions: 1, binary: false, kind: "file", state: live.reverted ? "reverted" : "can-revert", ...more });
const changes = () => ({
  ok: true, available: true, taskId: "built", projectId: "fixture", attempt: 2, runId: "run_2_1", state: "ended",
  attempts: [{ n: 2, runId: "run_2_1", startedAt: ${now - 300000}, endedAt: ${now - 120000}, ended: true, selected: true, reverts: [], accepted: live.accepted, running: false }, { n: 1, runId: "run_1_1", startedAt: ${now - 900000}, endedAt: ${now - 800000}, ended: true, selected: false, reverts: [], accepted: false, running: false }],
  files: [file("src/components/NotesHeader.tsx"), file("src/styles/a-very-long-stylesheet-name-that-keeps-going-and-going-on-and-on-without-a-break-to-test-wrapping.css", { additions: 12, deletions: 3 }), file("docs/header.md", { status: "added", additions: 9, deletions: 0 }), file("assets/logo.png", { binary: true, additions: 0, deletions: 0 }), file("src/old-header.tsx", { status: "deleted", additions: 0, deletions: 30 }), file("src/Header.tsx", { status: "renamed", oldPath: "src/NotesTitle.tsx", additions: 2, deletions: 2 })],
  totals: { files: 6, additions: 27, deletions: 36, binary: 1 }, more: 0, skipped: { count: 1, files: ["video.mp4"], sentence: "1 file over the size limit was left out of the pictures: video.mp4." }, overlap: [], worktree: false,
  accepted: live.accepted, running: false, waiting: false, canAccept: !live.reverted, canRevert: !live.reverted,
});
const results = () => [{ id: "typecheck", label: "Typecheck", status: "ok", detail: "0 errors", ms: 900 }, { id: "lint", label: "Lint", status: "warn", detail: "2 warnings", ms: 400, tail: "src/Header.tsx  12:4  warning  'unused' is defined but never used\\nsrc/styles/a.css  3:1  warning  very long line ".repeat(1) + "x".repeat(200) }, live.buildRan ? { id: "build", label: "Build", status: "ok", detail: "Built in 1.9 s", ms: 1900 } : { id: "build", label: "Build", status: "skipped", detail: "Not run on its own, because a build writes files. Run it now." }];
const log = (name, payload) => { calls.push([name, JSON.parse(JSON.stringify(payload ?? {}))]); };
const diffLines = [{ k: "h", t: "@@ -10,7 +10,10 @@ export function NotesHeader() {" }, { k: " ", t: "  return (", a: 10, b: 10 }, { k: "-", t: "    <header className=\\"header\\">", a: 11 }, { k: "+", t: "    <header className=\\"header header--sticky\\" style={{ position: 'sticky', top: 0, zIndex: 10 }}>", b: 11 }, { k: "+", t: "<script>alert('a line of the project is text')</script>", b: 12 }, { k: " ", t: "      <h1>Notes</h1>", a: 12, b: 13 }];
const api = {
  ...Object.fromEntries(Object.keys(responses).map((key) => [key, async () => responses[key]])),
  tasksChanges: async (p) => { log("changes", p); return changes(); },
  tasksDiff: async (p) => { log("diff", p); return { ok: true, path: p.path, status: "modified", additions: 2, deletions: 1, binary: false, truncated: false, lines: diffLines }; },
  tasksAccept: async (p) => { log("accept", p); live.accepted = p.accepted !== false; return { ok: true, accepted: live.accepted, attempt: p.attempt }; },
  tasksRevert: async (p) => { log("revert", p); if (p.undo) { live.reverted = false; return { ok: true, reverted: 6, undo: true }; } live.reverted = true; live.accepted = false; return { ok: true, reverted: p.scope === "file" ? 1 : 6, files: 6, already: 0, refused: [], receipt: "20260930T101010101Z", scope: p.scope, reopened: p.scope === "attempt" }; },
  tasksChecks: async (p) => { log("checks", p); return { ok: true, available: true, taskId: "built", projectId: "fixture", attempt: 2, at: ${now - 100000}, results: results(), detected: [{ id: "typecheck", label: "Typecheck", auto: true, writes: false }, { id: "lint", label: "Lint", auto: true, writes: false }, { id: "build", label: "Build", auto: false, writes: true }], none: false, build: false }; },
  tasksCheckRun: async (p) => { log("checkrun", p); live.buildRan = true; const all = results(); return { ok: true, attempt: 2, result: all.find((row) => row.id === p.id), results: all }; },
  tasksEvidence: async (p) => { log("evidence", p); return { ok: true, taskId: "built", projectId: "fixture", attempt: 2, runId: "run_2_1", enabled: live.prefs.shots, forced: false, shots: [{ phase: "before", at: ${now - 300000}, bytes: 900, width: 1280, height: 800, dataUrl: shots.before }, { phase: "after", at: ${now - 120000}, bytes: 900, width: 1280, height: 800, dataUrl: shots.after }], notes: { before: "Captured when the task started.", after: "Captured when the task finished." }, privacy: "Screenshots stay on this PC. They can show secrets, so they are never added to a problem report." }; },
  reviewPrefs: async (p) => { log("prefs", p); Object.assign(live.prefs, p); return { ok: true, prefs: { ...live.prefs }, saved: { ...live.prefs }, forced: { snapshots: false, advisory: false, shots: false } }; },
  onReviewChanged: (callback) => { listeners.push(callback); },
  __fixture: { calls: () => calls.map((row) => [row[0], row[1]]), push: (event) => { for (const callback of listeners) callback(event); } },
};
contextBridge.exposeInMainWorld("mefiStudio", api);
localStorage.setItem("mefiStudio.zen", "0"); localStorage.setItem("mefiStudio.commandHome", "0"); localStorage.setItem("mefiStudio.zenReactive", "0");
`);
  const window = new BrowserWindow({ show: false, width: 1360, height: 980, webPreferences: { preload, contextIsolation: true, nodeIntegration: false, sandbox: true, offscreen: true, backgroundThrottling: false } });
  const contents = window.webContents; contents.setAudioMuted(true); contents.setFrameRate(30); contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("console-message", (_event, detail, oldMessage) => { const level = typeof detail === "object" ? detail.level : detail; if (level === "error" || level === 3) report.errors.push(String(typeof detail === "object" ? detail.message : oldMessage)); });
  contents.on("render-process-gone", (_event, detail) => finish(new Error(`Renderer exited: ${detail.reason}`)));
  const run = (code) => contents.executeJavaScript(`(async()=>{${code}})()`, true);
  const until = async (expression, label) => { const deadline = Date.now() + 8000; while (Date.now() < deadline) { assert.deepEqual(report.errors, [], JSON.stringify(report.errors)); if (await run(`return Boolean(${expression});`)) return; await sleep(35); } throw new Error(`Timed out: ${label}`); };
  const capturePage = async () => {
    const deadline = Date.now() + 30000;
    for (;;) {
      try { return await contents.capturePage(); } catch (error) {
        if (!/UnknownVizError/i.test(String(error?.message ?? error)) || Date.now() > deadline) throw error;
        await sleep(120);
      }
    }
  };
  const capture = async (name) => { await sleep(160); fs.writeFileSync(path.join(root, name), (await capturePage()).toPNG()); };
  const calls = () => run("return window.mefiStudio.__fixture.calls();");
  const callsNamed = async (name) => (await calls()).filter(([call]) => call === name).map(([, payload]) => payload);
  // What the section looks like right now: does anything overflow, scroll on its own or read smaller than 12 px.
  const inspect = async (label) => {
    const seen = await run(`
      const box = document.querySelector('.task-review');
      const inside = box.getBoundingClientRect();
      const all = [...box.querySelectorAll('*')].filter((node) => node.getClientRects().length);
      const hasText = (node) => [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim());
      return {
        label: ${JSON.stringify(label)}, width: innerWidth,
        pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
        inside: { left: inside.left, right: inside.right, width: inside.width },
        clipped: all.filter((node) => node.getBoundingClientRect().right > inside.right + 1 || node.getBoundingClientRect().left < inside.left - 1).map((node) => (node.className || node.tagName) + ' [' + Math.round(node.getBoundingClientRect().left) + ',' + Math.round(node.getBoundingClientRect().right) + ']'),
        tiny: all.filter((node) => hasText(node) && parseFloat(getComputedStyle(node).fontSize) > 0 && parseFloat(getComputedStyle(node).fontSize) < 12).map((node) => node.className + ' ' + getComputedStyle(node).fontSize),
        scrollers: all.filter((node) => { const style = getComputedStyle(node); return /auto|scroll/.test(style.overflowX + style.overflowY); }).map((node) => node.className || node.tagName),
        gutters: all.filter((node) => node.offsetWidth - node.clientWidth > (parseFloat(getComputedStyle(node).borderLeftWidth) || 0) + (parseFloat(getComputedStyle(node).borderRightWidth) || 0) + 1 && getComputedStyle(node).display !== 'inline').map((node) => node.className || node.tagName),
      };`);
    report.layouts.push(seen);
    if (seen.clipped.length || seen.tiny.length || seen.scrollers.length || seen.pageOverflow) await capture(`review-problem-${label.replace(/[^a-z0-9]+/gi, "-")}.png`);
    assert.ok(!seen.pageOverflow, `${label}: the page overflows sideways ${JSON.stringify(seen)}`);
    assert.deepEqual(seen.clipped, [], `${label}: something leaves the section`);
    assert.deepEqual(seen.tiny, [], `${label}: text under 12 px`);
    assert.deepEqual(seen.scrollers, [], `${label}: a scroller of its own`);
    return seen;
  };

  await window.loadFile(path.join(root, "renderer", "booklet.html"), { query: { capture: "1" } });
  await until("window.MefiTasks && window.MefiNav && window.MefiReview && window.MefiUi?.arm", "startup");
  await run("window.MefiNav.go('tasks');");
  await until("document.getElementById('task-list')?.textContent.includes('sticky header')", "the task list");
  await until("!document.getElementById('boot-layer') || document.getElementById('boot-layer').hidden", "startup fade finishes before visual inspection");

  // A task no worker touched has no review section; one that ran has it, open.
  await run("await window.MefiTasks.open({taskId:'idle'}); document.getElementById('task-tab-evidence').click();");
  await sleep(300);
  report.idleHasSection = await run("return Boolean(document.querySelector('.task-review'));");
  assert.equal(report.idleHasSection, false, "nothing ran, so there is nothing to review");
  assert.equal((await calls()).length, 0, "and the host was not asked anything");
  await run("await window.MefiTasks.open({taskId:'built'}); document.getElementById('task-tab-evidence').click();");
  await until("document.querySelectorAll('.task-review .review-file').length === 6", "the changed files");
  report.heading = await run("return document.querySelector('.task-review > summary').textContent;");
  assert.equal(report.heading, "Changes and checks · 6 files changed");
  report.open = await run("return document.querySelector('.task-review').open;");
  assert.equal(report.open, true, "opened by itself for a task that ran");
  assert.deepEqual(await callsNamed("changes"), [{ taskId: "built", projectId: "fixture" }], "one read of the list, for this task");

  // The list, with the section's own controls.
  const rows = await run("return [...document.querySelectorAll('.task-review .review-file')].map((row) => ({ name: row.querySelector('.review-file-name').textContent, text: row.textContent, state: row.dataset.state, buttons: [...row.querySelectorAll('button')].map((button) => button.getAttribute('aria-label') || button.textContent) }));");
  report.rows = rows;
  assert.match(rows[1].name, /a-very-long-stylesheet-name/);
  assert.match(rows[4].text, /Deleted/);
  assert.match(rows[2].text, /Added/);
  assert.match(rows[5].text, /Renamed/);
  assert.match(rows[5].text, /was src\/NotesTitle\.tsx/);
  assert.match(rows[3].text, /binary/);
  assert.ok(rows.every((row) => row.buttons.some((label) => /^Revert /.test(label))), "each file can be reverted on its own");
  const text = await run("return document.querySelector('.task-review').textContent;");
  assert.match(text, /Read from git, so it looks the same whichever builder did the work\./);
  assert.match(text, /Files git ignores, such as node_modules, can't be restored\./);
  assert.match(text, /1 file over the size limit was left out of the pictures: video\.mp4\./);
  assert.match(text, /Attempt/);
  await run("document.querySelector('.task-review').scrollIntoView({block:'start',behavior:'instant'});");
  await inspect("files, wide");
  await capture("review-files-wide.png");

  // A diff is text.
  await run("document.querySelector('.task-review .review-file-main').click();");
  await until("document.querySelector('.task-review .review-diff .review-diff-line')", "the diff");
  report.diffText = await run("return document.querySelector('.task-review .review-diff').textContent;");
  assert.match(report.diffText, /<script>alert\('a line of the project is text'\)<\/script>/);
  assert.equal(await run("return document.querySelectorAll('.task-review script').length;"), 0, "a line of the project is never markup");
  assert.deepEqual(await callsNamed("diff"), [{ taskId: "built", projectId: "fixture", attempt: 2, path: "src/components/NotesHeader.tsx" }]);
  await inspect("diff, wide");
  await capture("review-diff-wide.png");

  // Accept, then the two presses of Revert attempt.
  await run("[...document.querySelectorAll('.task-review button')].find((button) => button.textContent === 'Accept changes').click();");
  await until("document.querySelector('.task-review .review-chip[data-tone=good]')?.textContent.includes('Accepted')", "the accepted chip");
  assert.equal((await callsNamed("accept")).length, 1);
  await run("[...document.querySelectorAll('.task-review button')].find((button) => button.textContent === 'Revert attempt').click();");
  await sleep(150);
  assert.equal((await callsNamed("revert")).length, 0, "one press only asks");
  report.armedLabel = await run("return [...document.querySelectorAll('.task-review button')].find((button) => button.classList.contains('danger-armed'))?.textContent ?? '';");
  assert.equal(report.armedLabel, "Revert all 6");
  await capture("review-armed.png");
  await run("document.querySelector('.task-review button.danger-armed').click();");
  await until("document.querySelector('.task-review .review-note')?.textContent.includes('Put back 6 files')", "the revert's note");
  assert.deepEqual((await callsNamed("revert")).map((row) => [row.scope, row.attempt, row.partial]), [["attempt", 2, undefined]]);
  assert.match(await run("return document.querySelector('.task-review .review-note').textContent;"), /The task is reopened\. A copy of the folder as it was is kept\./);
  await until("document.querySelector('.task-review')?.textContent.includes('Everything was reverted')", "everything reverted");
  await inspect("reverted, wide");
  await capture("review-reverted-wide.png");
  await run("[...document.querySelectorAll('.task-review button')].find((button) => button.textContent === 'Undo the revert').click();");
  await until("!document.querySelector('.task-review')?.textContent.includes('Everything was reverted')", "the undo");
  assert.equal((await callsNamed("revert")).at(-1).undo, "20260930T101010101Z");

  // Checks: marks and sentences, a failure's output as text, Run for the build.
  await run("[...document.querySelectorAll('.task-review .review-tab')].find((tab) => tab.textContent.startsWith('Checks')).click();");
  await until("document.querySelectorAll('.task-review .review-check').length === 3", "the checks");
  report.checks = await run("return [...document.querySelectorAll('.task-review .review-check')].map((row) => ({ status: row.dataset.status, text: row.textContent, mark: row.querySelector('.review-mark').getAttribute('aria-label') }));");
  assert.deepEqual(report.checks.map((row) => [row.status, row.mark]), [["ok", "Passed"], ["warn", "Warnings"], ["skipped", "Not run"]]);
  assert.match(await run("return document.querySelector('.task-review').textContent;"), /Advisory — never blocks Done/);
  await run("document.querySelector('.task-review .review-tail summary').click();");
  await run("document.querySelector('.task-review .review-tail').open = true;");
  await inspect("checks, wide");
  await capture("review-checks-wide.png");
  await run("[...document.querySelectorAll('.task-review button')].find((button) => button.getAttribute('aria-label') === 'Run Build').click();");
  await until("document.querySelectorAll('.task-review .review-check')[2]?.dataset.status === 'ok'", "the build's result");
  assert.deepEqual(await callsNamed("checkrun"), [{ taskId: "built", projectId: "fixture", attempt: 2, id: "build" }]);

  // Preview: two real pictures, decoded.
  await run("[...document.querySelectorAll('.task-review .review-tab')].find((tab) => tab.textContent.startsWith('Preview')).click();");
  await until("document.querySelectorAll('.task-review .review-shot-image').length === 2", "the shots");
  await until("[...document.querySelectorAll('.task-review .review-shot-image')].every((image) => image.complete && image.naturalWidth > 0)", "the shots decode");
  report.shots = await run("return [...document.querySelectorAll('.task-review .review-shot')].map((figure) => ({ phase: figure.dataset.phase, caption: figure.querySelector('figcaption').textContent, width: figure.querySelector('img').naturalWidth, shown: figure.querySelector('img').getBoundingClientRect().width }));");
  assert.deepEqual(report.shots.map((shot) => shot.phase), ["before", "after"]);
  assert.match(report.shots[0].caption, /Captured when the task started\./);
  assert.ok(report.shots.every((shot) => shot.width === 320 && shot.shown > 100));
  assert.match(await run("return document.querySelector('.task-review').textContent;"), /Screenshots stay on this PC\. They can show secrets, so they are never added to a problem report\./);
  await inspect("preview, wide");
  await capture("review-preview-wide.png");

  // The three switches, from the section.
  await run("const settings = document.querySelector('.task-review .review-settings'); settings.open = true;");
  await until("document.querySelectorAll('.task-review .review-switch input').length === 4", "the switches");
  assert.deepEqual(await run("return [...document.querySelectorAll('.task-review .review-switch input')].map((box) => box.checked);"), [true, true, false, true]);
  await run("document.querySelectorAll('.task-review .review-switch input')[3].click();");
  await until("document.querySelectorAll('.task-review .review-switch input')[3].checked === false", "the shots switch turns off");
  assert.deepEqual((await callsNamed("prefs")).at(-1), { shots: false });
  await inspect("settings, wide");
  await capture("review-settings-wide.png");

  // The host's push refreshes what it names.
  const before = (await callsNamed("checks")).length;
  await run("[...document.querySelectorAll('.task-review .review-tab')].find((tab) => tab.textContent.startsWith('Checks')).click();");
  await until("document.querySelectorAll('.task-review .review-check').length === 3", "checks again");
  const again = (await callsNamed("checks")).length;
  await run("window.mefiStudio.__fixture.push({ projectId: 'fixture', taskId: 'built', attempt: 2, what: 'checks' });");
  await sleep(900);
  report.pushRead = (await callsNamed("checks")).length > again;
  assert.ok(report.pushRead, `a checks push reads the checks again (${before}, ${again})`);

  // Narrower windows: nothing leaves the section, no text under 12 px, no scroller of its own.
  await run("[...document.querySelectorAll('.task-review .review-tab')].find((tab) => tab.textContent.startsWith('Changed')).click();");
  await until("document.querySelectorAll('.task-review .review-file').length === 6", "files again");
  await run("if (!document.querySelector('.task-review .review-diff')) document.querySelector('.task-review .review-file-main').click();");
  await until("document.querySelector('.task-review .review-diff .review-diff-line')", "the diff again");
  for (const [width, height, name] of [[1000, 800, "medium"], [600, 900, "narrow"]]) {
    window.setContentSize(width, height);
    await sleep(240);
    await run("document.querySelector('.task-review').scrollIntoView({block:'start',behavior:'instant'});");
    await inspect(`files and diff, ${name}`);
    await capture(`review-files-${name}.png`);
    await run("[...document.querySelectorAll('.task-review .review-tab')].find((tab) => tab.textContent.startsWith('Preview')).click();");
    await until("document.querySelectorAll('.task-review .review-shot-image').length === 2", `shots, ${name}`);
    const stacked = await run("const [a, b] = [...document.querySelectorAll('.task-review .review-shot')].map((figure) => figure.getBoundingClientRect()); return { sideBySide: Math.abs(a.top - b.top) < 4 };");
    report[`shotsSideBySide${name}`] = stacked.sideBySide;
    await inspect(`preview, ${name}`);
    await capture(`review-preview-${name}.png`);
    await run("[...document.querySelectorAll('.task-review .review-tab')].find((tab) => tab.textContent.startsWith('Changed')).click();");
    await until("document.querySelectorAll('.task-review .review-file').length === 6", `files again, ${name}`);
  }
  assert.equal(report.shotsSideBySidenarrow, false, "one column at 600 px");
  assert.deepEqual(report.errors, []); assert.deepEqual(report.networkAttempts, []); assert.deepEqual(report.processAttempts, []);
  report.complete = true;
  finish();
}).catch(finish);
