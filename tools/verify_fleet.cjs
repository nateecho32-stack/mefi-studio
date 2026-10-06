"use strict";
// Real-app check of Live > Fleet (docs/fleet-overhaul-plan.md). It boots the
// app's own main.cjs in smoke mode (a hidden window, no timers, no network) on
// a THROWAWAY profile, then drives that window through the real preload bridge,
// the real ipcMain handlers and the real fleet host. tests/fleet_render.test.mjs
// paints the page against a fake bridge; this proves the wires behind it,
// including the fresh-profile case where no project is open.
//
//   node_modules/.bin/electron tools/verify_fleet.cjs
//
// It refuses to run unless Electron's userData is the folder it just made, so
// the owner's settings, keys and projects are never touched. Exit code 0 means
// every step passed. The steps print as they finish and are saved as
// verify-fleet.json in MEFI_VERIFY_FLEET_OUT (default: a folder under the
// temp directory). The window is hidden, so this makes no screenshots.
const { app } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const out = path.resolve(process.env.MEFI_VERIFY_FLEET_OUT || path.join(os.tmpdir(), "mefi-verify-fleet-report"));
fs.mkdirSync(out, { recursive: true });
// Profiles of earlier runs that could not delete themselves (Windows holds
// their files until the process ends) go when the next run starts.
for (const name of fs.readdirSync(os.tmpdir())) {
  if (!name.startsWith("mefi-verify-fleet-profile-")) continue;
  try { fs.rmSync(path.join(os.tmpdir(), name), { recursive: true, force: true, maxRetries: 3 }); } catch { /* still in use */ }
}
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "mefi-verify-fleet-profile-"));
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const refuse = (why) => { console.error(`REFUSING TO RUN: ${why}`); process.exit(3); };

app.setPath("userData", profile);
if (!same(app.getPath("userData"), profile)) refuse("userData is not the throwaway profile");
process.argv.push("--smoke");
// main's smoke run ends itself with app.exit; hold that until the checks are done.
const realExit = app.exit.bind(app);
let smokeExit = null;
app.exit = (code) => { smokeExit = code; };

const report = { steps: {}, consoleErrors: [], failure: null };
let mainWin = null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function finish(code) {
  fs.writeFileSync(path.join(out, "verify-fleet.json"), `${JSON.stringify({ ...report, smokeExit }, null, 2)}\n`);
  console.log(`[verify-fleet] ${code === 0 ? "PASS" : "FAIL"} ${report.failure ?? ""}`);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* removed by the next run */ }
  realExit(code);
}

app.on("browser-window-created", (_event, win) => {
  if (mainWin) return;
  mainWin = win;
  win.webContents.on("console-message", (...args) => {
    const details = args[1] && typeof args[1] === "object" && "message" in args[1] ? args[1] : { level: args[1], message: args[2] };
    if (details.level === "error" || details.level === 3) report.consoleErrors.push(String(details.message ?? "").slice(0, 300));
  });
  win.webContents.once("did-finish-load", () => drive().catch((error) => { report.failure = String(error?.stack ?? error).slice(0, 800); finish(1); }));
});

require(path.join(root, "main.cjs"));
if (!same(app.getPath("userData"), profile)) refuse("main.cjs moved userData off the throwaway profile");

async function drive() {
  const wc = mainWin.webContents;
  const run = (code) => wc.executeJavaScript(`(async () => { ${code} })()`);
  const until = async (condition, label, ms = 20000) => {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) { if (await run(`return Boolean(${condition});`)) return; await sleep(80); }
    throw new Error(`Timed out: ${label}`);
  };
  const check = (name, ok, detail) => {
    report.steps[name] = { ok: Boolean(ok), detail };
    console.log(`[verify-fleet] ${ok ? "ok  " : "FAIL"} ${name}`);
    if (!ok) throw new Error(`${name}: ${JSON.stringify(detail).slice(0, 400)}`);
  };

  await until("window.MefiNav && window.MefiFleet && !window.MefiBoot?.isActive?.()", "the app is ready");
  const bridge = await run(`return Object.fromEntries(["fleetSnapshot", "fleetWatch", "fleetSeat", "fleetAction", "onFleetUpdate"].map((name) => [name, typeof window.mefiStudio?.[name]]));`);
  check("the preload bridge carries the five fleet calls", Object.values(bridge).every((type) => type === "function"), bridge);

  // fleet:snapshot through the real handler, on a profile with no project open.
  const snap = await run(`const view = await window.mefiStudio.fleetSnapshot(); return { ok: view?.ok, error: view?.error ?? null, pods: (view?.pods ?? []).map((pod) => [pod.id, pod.seats.length]), seats: view?.counts?.seats ?? 0, loop: view?.loop?.state ?? null, first: view?.pods?.flatMap((pod) => pod.seats)[0]?.id ?? null };`);
  check("fleet:snapshot answers with the four pods", snap.ok === true && snap.pods.length === 4 && snap.seats >= 1 && Boolean(snap.first), snap);

  // The page: opening it takes the watch lease, and the host pushes at once.
  await run(`window.__pushes = []; window.mefiStudio.onFleetUpdate((view) => window.__pushes.push(view?.counts?.seats ?? null)); window.MefiNav.go("fleet");`);
  await until("window.MefiFleet.isOpen() && document.querySelectorAll('.fleet-seat').length > 0", "the page paints the seats");
  await until("window.__pushes.length >= 1", "the watch lease brings a first fleet:update push");
  const page = await run(`const count = (selector) => document.querySelectorAll(selector).length; return { cards: count('.fleet-seat'), explorer: count('#fleet-tree [role="treeitem"]'), status: document.getElementById('fleet-status').textContent, pushes: window.__pushes.length };`);
  check("the page paints one card and one explorer row per seat", page.cards === snap.seats && page.explorer >= snap.seats && page.pushes >= 1, page);

  const tabs = {};
  for (const tab of ["table", "recent", "nodes", "health", "graph"]) {
    await run(`document.getElementById('fleet-tab-${tab}').click();`);
    await sleep(150);
    tabs[tab] = await run(`const panel = document.getElementById('fleet-${tab}'); return { shown: !panel.hidden, text: panel.textContent.trim().slice(0, 80) };`);
  }
  check("all five views show", Object.values(tabs).every((view) => view.shown && view.text), tabs);

  // A seat: the real fleet:seat fills the inspector, and fleet:action answers plainly.
  const seat = JSON.stringify(snap.first);
  await run(`document.querySelector('.fleet-seat[data-seat=' + JSON.stringify(${seat}) + ']').click();`);
  await until(`document.getElementById('fleet-inspector').textContent.includes(${JSON.stringify(snap.first.split("@")[0])})`, "the inspector names the seat");
  const buttons = await run(`return [...document.getElementById('fleet-inspector').querySelectorAll('button')].map((button) => button.textContent.trim());`);
  check("the inspector opens for a seat with Open in Map", buttons.includes("Open in Map"), buttons);
  const detail = await run(`const reply = await window.mefiStudio.fleetSeat(${seat}); return { ok: reply?.ok, seat: reply?.seat?.id ?? null };`);
  check("fleet:seat returns the seat", detail.ok === true && detail.seat === snap.first, detail);
  const actions = await run(`const act = (seatId, action) => window.mefiStudio.fleetAction({ seatId, action }); return { stop: await act(${seat}, "stop"), openTask: await act(${seat}, "open-task"), unknown: await act(${seat}, "nope"), missing: await act("nobody@nowhere", "stop") };`);
  check("fleet:action refuses an idle seat, an unknown action and an unknown seat in plain words", Object.values(actions).every((reply) => reply.ok === false && typeof reply.error === "string" && reply.error.length > 10), actions);

  // Closing gives the lease back: nothing else holds the watch afterwards.
  await run(`document.getElementById('fleet-close').click();`);
  await until("!window.MefiFleet.isOpen()", "the page closes");
  await sleep(300);
  const released = await run(`return await window.mefiStudio.fleetWatch({ id: "verify", on: false });`);
  check("closing the page returns its watch lease", released.ok === true && released.watching === false, released);
  const lease = await run(`const on = await window.mefiStudio.fleetWatch({ id: "verify", on: true }); const off = await window.mefiStudio.fleetWatch({ id: "verify", on: false }); return { on, off };`);
  check("a lease can be taken and given back", lease.on.watching === true && lease.off.watching === false, lease);

  check("the window logged no console errors", report.consoleErrors.length === 0, report.consoleErrors);
  finish(0);
}
