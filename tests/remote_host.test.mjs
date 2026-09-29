// main.cjs "Discord remote" (docs/remote.md) in a vm against a fake hub client:
// only the owner's own account is answered; status, needs, made and digest
// read the PC; a DM is the owner's chat message marked remote; Approve needs
// the PIN, counts wrong ones, locks at five and says so; a button older than a
// day or a card that changed since is refused; alerts come from the look;
// Settings never sees the PIN; and the switch turns the hub side on and off.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import crypto from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const remoteRules = require("../scripts/remote.cjs");
const backlog = require("../scripts/backlog.cjs");
const companionModule = require("../scripts/companion.cjs");
const shareReview = require("../scripts/share-review.cjs");
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("// ---- Discord remote: your PCs from Discord DMs");
const to = main.indexOf("// ---- end of the Discord remote", from);
assert.ok(from > 0 && to > from, "main.cjs has a Discord remote block");
const block = main.slice(from, to);
const settingsFrom = main.indexOf("function updateSettings(mutate) {");
const settingsBlock = main.slice(settingsFrom, main.indexOf("\nfunction send(", settingsFrom));
const plain = (value) => JSON.parse(JSON.stringify(value));
const ME = "123456789012345678";
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((done) => setImmediate(done)); };

function host({ settings = {}, tasks = [], needs = { total: 0, counts: {}, items: [] }, snapshot = null, projectOpen = true, held = false, hubState = "ready" } = {}) {
  let saved = { remote: settings };
  const calls = [], replies = [], notices = [], sent = [];
  const client = {
    remote: null,
    status: () => ({ state: hubState, error: null, user: { id: ME, name: "Mefi" }, remote: true, remoteOn: Boolean(client.remote?.on), remotePcs: [] }),
    setRemote(value) { calls.push(["setRemote", value && plain(value)]); client.remote = value; return true; },
    connect: async () => { calls.push(["connect"]); return client.status(); },
    remoteReply: (requestId, text, buttons, done = true) => { replies.push({ requestId, text, buttons: plain(buttons ?? []), ...(done === false ? { interim: true } : {}) }); return true; },
    remoteNotice: (key, kind, text, buttons) => { notices.push({ key, kind, text, buttons: plain(buttons ?? []) }); return true; },
  };
  const board = { tasks };
  const context = vm.createContext({
    Date, Math, JSON, Number, String, Array, Object, Map, Set, Promise, Boolean,
    SMOKE: false, CAPTURE: false, CLI_MODE: false,
    crypto, os: { hostname: () => "DESKTOP-HOME" },
    optionalHelper: () => remoteRules,
    require: () => remoteRules,
    readSettings: async () => JSON.parse(JSON.stringify(saved)),
    settingsDisk: { queue: Promise.resolve() },
    writeSettings: async (value) => { saved = JSON.parse(JSON.stringify(value)); },
    hubClient: client, hubInstance: () => client,
    hubModule: { hubAddress: () => ({ http: "https://hub", ws: "wss://hub/v1/ws" }) }, communityHubUrl: () => "https://hub",
    communityRead: async () => ({ state: { link: { userId: ME } } }),
    send: (channel, payload) => sent.push([channel, payload]),
    logLine: () => {},
    coworkMachineId: async () => "pc-0000",
    setInterval: () => ({ unref() {} }), clearInterval: () => {},
    agentsSnapshot: async () => snapshot,
    assistantNeedsYouDigest: async () => needs,
    assistantPause: async () => { calls.push(["pause"]); },
    releaseStartupHold: async () => { calls.push(["release"]); context.autopilot.held = false; },
    assistantControl: async (action) => { calls.push(["control", action]); },
    autopilot: { held, autoBuild: true, approve: () => true },
    projects: { open: () => (projectOpen ? { id: "p1", name: "Quillfold" } : null), current: () => ({ id: "p1" }) },
    assistantMessage: async (text, options) => { calls.push(["message", text, plain(options)]); return { ok: true, reply: { text: `Mefi: got "${text}".` } }; },
    getEyes: async () => ({ readJson: async () => board.tasks }),
    TASKS_PATH: "tasks.json",
    backlog, companionModule, shareReview,
    backlogControl: async (payload) => {
      calls.push(["approve", plain(payload)]);
      const task = board.tasks.find((row) => row.id === payload.taskId);
      if (payload.expectedScope !== backlog.buildScope(task)) return { ok: false, error: "This task changed or its reviewed scope is missing." };
      task.buildApproval = { version: 1, scope: payload.expectedScope };
      return { ok: true, taskId: payload.taskId };
    },
    agentBrain: { events: async () => ({ ok: true, events: [] }) },
  });
  vm.runInContext(`${settingsBlock}\n${block}\nthis.api = { remoteHear, remoteLook, remoteApply, remoteSet, remotePin, remoteStatus, approvals: remoteApprovals, log: remoteLog };`, context);
  return { api: context.api, context, calls, replies, notices, sent, board, client, saved: () => saved };
}
const command = (fields) => ({ requestId: `req_${Math.random().toString(36).slice(2, 8)}`, from: ME, sentAt: Date.now(), ...fields });

test("only the owner's own account is answered, and only while the remote is on", async () => {
  const off = host({ settings: { on: false } });
  await off.api.remoteHear(command({ command: "status" }));
  assert.equal(off.replies.length, 0, "off: nothing is answered");
  const h = host({ settings: { on: true }, snapshot: { project: "Quillfold", state: "running", headline: "1 agent working", working: [{ title: "Add login", since: Date.now() - 60000 }], needsYou: 0, done: [], failed: [] } });
  await h.api.remoteHear(command({ command: "status", from: "999999999999999999" }));
  assert.equal(h.replies.length, 0, "someone else's DM never reaches this PC");
  await h.api.remoteHear(command({ command: "status" }));
  assert.match(h.replies[0].text, /^\*\*Quillfold\*\* · 1 agent working\n• Add login \(1 min\)/);
  assert.deepEqual(plain(h.api.log.map((row) => row.command)), ["status"], "the log keeps the command, never its words");
  await settle();
  assert.ok(h.sent.some(([channel]) => channel === "remote:event"), "Settings hears about it");
});

test("a DM is the owner's own chat message, marked as from Discord", async () => {
  const h = host({ settings: { on: true } });
  await h.api.remoteHear(command({ command: "say", text: "Add a dark mode" }));
  assert.deepEqual(h.calls.find((row) => row[0] === "message"), ["message", "Add a dark mode", { remote: true }]);
  assert.deepEqual(h.replies.map((row) => [row.text, row.interim === true]), [["Mefi is on it…", true], ['Mefi: got "Add a dark mode".', false]], "a quick word first, the answer after");
  assert.equal(new Set(h.replies.map((row) => row.requestId)).size, 1, "both answer the same request");
  const closed = host({ settings: { on: true }, projectOpen: false });
  await closed.api.remoteHear(command({ command: "say", text: "hello" }));
  assert.match(closed.replies.at(-1).text, /No project is open/);
  assert.equal(closed.calls.some((row) => row[0] === "message"), false);
});

test("pause and resume brake new work; resume also lifts the launch hold", async () => {
  const h = host({ settings: { on: true }, held: true });
  await h.api.remoteHear(command({ command: "pause" }));
  await h.api.remoteHear(command({ command: "resume" }));
  await h.api.remoteHear(command({ command: "resume" }));
  assert.deepEqual(h.calls.filter((row) => ["pause", "release", "control"].includes(row[0])), [["pause"], ["release"], ["control", "start-work"]]);
  assert.match(h.replies[0].text, /^Paused/);
  assert.match(h.replies[1].text, /^Resumed/);
});

function approvalBoard() {
  const task = { id: "t1", title: "Ship the settings page", prompt: "Ship it", status: "open", origin: { by: "owner", via: "remote" } };
  return { task, needs: { total: 1, counts: { approval: 1 }, items: [{ kind: "approval", title: "Ship the settings page", taskId: "t1" }] } };
}

test("concurrent PIN attempts share one lockout counter and an approval button is consumed once", async () => {
  const { task, needs } = approvalBoard();
  const h = host({ settings: { on: true, pin: remoteRules.hashPin("4321") }, tasks: [task], needs });
  await h.api.remoteHear(command({ command: "needs" }));
  const [button] = h.replies[0].buttons;
  await Promise.all(Array.from({ length: 8 }, () => h.api.remoteHear(command({ command: "button", buttonId: button.id, pin: "0000" }))));
  assert.equal(h.saved().remote.lock.failures, 5);
  assert.equal(h.notices.length, 1, "only the transition to locked sends a notice");
  await h.api.remoteHear(command({ command: "button", buttonId: button.id, pin: "4321" }));
  assert.equal(h.calls.some(([kind]) => kind === "approve"), false);
  await h.api.remotePin({ unlock: true });
  await h.api.remoteHear(command({ command: "button", buttonId: button.id, pin: "0000" }));
  await Promise.all(Array.from({ length: 3 }, () => h.api.remoteHear(command({ command: "button", buttonId: button.id, pin: "4321" }))));
  assert.equal(h.calls.filter(([kind]) => kind === "approve").length, 1);
  assert.equal(h.saved().remote.lock.failures, 0);
});

test("a settings toggle cannot restore a stale PIN or lockout snapshot", async () => {
  const h = host({ settings: { on: true, pin: remoteRules.hashPin("4321"), lock: { failures: 4 } } });
  await Promise.all([h.api.remotePin({ pin: "9876" }), h.api.remoteSet({ name: "Renamed PC" })]);
  assert.equal(remoteRules.checkPin("9876", h.saved().remote.pin), true);
  assert.equal(h.saved().remote.name, "Renamed PC");
  assert.equal(h.saved().remote.lock.failures, 0);
});

test("queued approval observes disabling, PIN replacement and handle expiry", async () => {
  for (const action of ["disable", "replace", "clear", "expire"]) {
    const { task, needs } = approvalBoard();
    const h = host({ settings: { on: true, pin: remoteRules.hashPin("4321") }, tasks: [task], needs });
    await h.api.remoteHear(command({ command: "needs" }));
    const [button] = h.replies[0].buttons;
    let release;
    h.context.settingsDisk.queue = new Promise((done) => { release = done; });
    const change = action === "disable" ? h.api.remoteSet({ on: false }) : action === "replace" ? h.api.remotePin({ pin: "9876" }) : action === "clear" ? h.api.remotePin({ clear: true }) : Promise.resolve();
    const approve = h.api.remoteHear(command({ command: "button", buttonId: button.id, pin: "4321" }));
    await settle();
    if (action === "expire") h.api.approvals.get(button.id).at -= 2 * 24 * 60 * 60 * 1000;
    release();
    await Promise.all([change, approve]);
    assert.equal(h.calls.some(([kind]) => kind === "approve"), false, action);
  }
});

test("needs offers Approve only with a PIN, and the PIN approves exactly the scope that was shown", async () => {
  const { task, needs } = approvalBoard();
  const nopin = host({ settings: { on: true }, tasks: [task], needs });
  await nopin.api.remoteHear(command({ command: "needs" }));
  assert.deepEqual(nopin.replies[0].buttons, []);
  assert.match(nopin.replies[0].text, /Set an approval PIN in Studio/);

  const h = host({ settings: { on: true, pin: remoteRules.hashPin("4321") }, tasks: [task], needs });
  await h.api.remoteHear(command({ command: "needs" }));
  const [button] = h.replies[0].buttons;
  assert.deepEqual({ label: button.label, pin: button.pin }, { label: "Approve 1", pin: true });
  assert.match(button.id, /^ap-[0-9a-f]{12}$/);

  await h.api.remoteHear(command({ command: "button", buttonId: button.id }));
  assert.match(h.replies.at(-1).text, /needs your PIN/);
  await h.api.remoteHear(command({ command: "button", buttonId: button.id, pin: "4321" }));
  assert.match(h.replies.at(-1).text, /^Approved: Ship the settings page/);
  const approval = h.calls.find((row) => row[0] === "approve")[1];
  assert.deepEqual({ action: approval.action, taskId: approval.taskId, via: approval.via }, { action: "approve", taskId: "t1", via: "remote" });
  assert.equal(approval.expectedScope, backlog.buildScope({ ...task, buildApproval: undefined }));
  await h.api.remoteHear(command({ command: "button", buttonId: button.id, pin: "4321" }));
  assert.match(h.replies.at(-1).text, /too old/, "a button approves once");
});

test("a card that changed after the button went out is not approved", async () => {
  const { task, needs } = approvalBoard();
  const h = host({ settings: { on: true, pin: remoteRules.hashPin("4321") }, tasks: [task], needs });
  await h.api.remoteHear(command({ command: "needs" }));
  const [button] = h.replies[0].buttons;
  h.board.tasks[0].prompt = "Ship it, and also delete the old logs";
  await h.api.remoteHear(command({ command: "button", buttonId: button.id, pin: "4321" }));
  assert.match(h.replies.at(-1).text, /^Not approved: This task changed/);
  assert.equal(h.board.tasks[0].buildApproval, undefined);
});

test("wrong PINs count, the fifth locks approvals and says so, and even the right PIN waits for Studio", async () => {
  const { task, needs } = approvalBoard();
  const h = host({ settings: { on: true, pin: remoteRules.hashPin("4321") }, tasks: [task], needs });
  await h.api.remoteHear(command({ command: "needs" }));
  const [button] = h.replies[0].buttons;
  for (let tries = 1; tries <= 4; tries += 1) {
    await h.api.remoteHear(command({ command: "button", buttonId: button.id, pin: "0000" }));
    assert.match(h.replies.at(-1).text, new RegExp(`${5 - tries} tr(y|ies) left`));
  }
  assert.equal(h.saved().remote.lock.failures, 4);
  await h.api.remoteHear(command({ command: "button", buttonId: button.id, pin: "0000" }));
  assert.match(h.replies.at(-1).text, /locked/);
  assert.equal(h.notices.length, 1);
  assert.match(h.notices[0].text, /Five wrong PINs/);
  await h.api.remoteHear(command({ command: "button", buttonId: button.id, pin: "4321" }));
  assert.match(h.replies.at(-1).text, /locked/, "locked means locked");
  assert.equal(h.calls.some((row) => row[0] === "approve"), false);
  assert.equal(h.api.log.filter((row) => row.note === "wrong PIN").length, 6);

  const unlocked = await h.api.remotePin({ unlock: true });
  assert.equal(unlocked.settings.locked, false);
  await h.api.remoteHear(command({ command: "button", buttonId: button.id, pin: "4321" }));
  assert.match(h.replies.at(-1).text, /^Approved/);
});

test("Settings saves the choices and the PIN's hash, and never sees the PIN", async () => {
  const h = host({ settings: {} });
  const status = await h.api.remoteSet({ on: true, name: "Desk", notify: { done: true } });
  assert.equal(status.settings.on, true);
  assert.equal(status.settings.name, "Desk");
  assert.equal(status.settings.notify.done, true);
  assert.deepEqual(h.calls.filter((row) => row[0] === "setRemote"), [["setRemote", { pc: { id: "pc-0000", name: "Desk" }, on: true }]]);
  assert.ok(h.calls.some((row) => row[0] === "connect"), "on keeps the hub connected");

  assert.equal((await h.api.remotePin({ pin: "12a" })).ok, false);
  const pinned = await h.api.remotePin({ pin: "135790" });
  assert.equal(pinned.settings.pinSet, true);
  assert.match(pinned.message, /PIN saved/);
  assert.ok(!JSON.stringify(pinned).includes("135790"));
  assert.ok(!JSON.stringify(pinned).includes(h.saved().remote.pin.hash), "the hash stays in main");
  assert.equal(remoteRules.checkPin("135790", h.saved().remote.pin), true);
  const cleared = await h.api.remotePin({ clear: true });
  assert.equal(cleared.settings.pinSet, false);

  await h.api.remoteSet({ on: false });
  assert.deepEqual(h.calls.filter((row) => row[0] === "setRemote").at(-1), ["setRemote", null], "off takes this PC off the remote");
});

test("the look turns changes into alerts, with a PIN'd Approve for a new approval", async () => {
  const { task, needs } = approvalBoard();
  const snapshot = { project: "Quillfold", state: "running", headline: "1 agent working", working: [], needsYou: 1, done: [], failed: [] };
  const h = host({ settings: { on: true, pin: remoteRules.hashPin("4321") }, tasks: [task], needs: { total: 0, counts: {}, items: [] }, snapshot });
  h.client.remote = { on: true };
  await h.api.remoteApply();
  await h.api.remoteLook();
  assert.equal(h.notices.length, 0, "the first look only remembers");
  h.context.assistantNeedsYouDigest = async () => needs;
  h.context.agentsSnapshot = async () => ({ ...snapshot, failed: ["Port the shaders"] });
  await h.api.remoteLook();
  assert.deepEqual(h.notices.map((row) => [row.kind, row.text]), [["needs-you", "🙋 Needs you: Ship the settings page"], ["failed", "⚠️ Stopped: Port the shaders"]]);
  assert.equal(h.notices[0].buttons[0].pin, true);
  assert.ok(h.api.approvals.has(h.notices[0].buttons[0].id), "the alert's Approve is a real handle");
});

test("what goes to Discord is scrubbed of paths, emails and keys first", async () => {
  const snapshot = { project: "Quillfold", state: "running", headline: "1 agent working", working: [{ title: "Fix the loader", since: Date.now(), step: "Bash running · node C:\\Users\\echor\\secret\\build.js --key sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789 to me@example.com" }], needsYou: 0, done: [], failed: [] };
  const h = host({ settings: { on: true }, snapshot });
  await h.api.remoteHear(command({ command: "made" }));
  const text = h.replies[0].text;
  assert.match(text, /Fix the loader/);
  assert.doesNotMatch(text, /echor|secret|build\.js|sk-ant-api03|me@example\.com/);
});
