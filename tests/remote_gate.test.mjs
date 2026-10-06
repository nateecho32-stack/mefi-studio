// What a message from Discord may do (docs/remote.md), outside the remote block
// itself: work it files waits for the owner's OK in every permission mode
// (autonomy.needsApproval), so do its slices, and approving is what releases
// them; the chat paths narrow a Discord message's actions (remote.gateActions)
// and stamp the work it files; and the preload bridge passes the PIN one way.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const autonomy = require("../scripts/autonomy.cjs");
const backlog = require("../scripts/backlog.cjs");
const remote = require("../scripts/remote.cjs");
const admission = require("../scripts/work-admission.cjs");
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const preloadSource = await readFile(new URL("../preload.cjs", import.meta.url), "utf8");
const plain = (value) => JSON.parse(JSON.stringify(value));

const remoteTask = { id: "r1", projectId: "p1", title: "Add dark mode", prompt: "Add dark mode", origin: { ...remote.ORIGIN } };

test("canonical admission retains remote provenance through task creation and request promotion", () => {
  const board = { tasks: [] };
  const task = admission.admitTask(board, { title: "Remote request", prompt: "Add search" }, { now: 1, allocateId: () => "r2", origin: { ...remote.ORIGIN, untrusted: true } }).created;
  assert.deepEqual(task.origin, remote.ORIGIN);
  const promoted = admission.taskRow({ id: "r3", title: "Promoted request" }, { now: 2, origin: admission.requestOrigin({ source: "manual", origin: remote.ORIGIN }) });
  for (const row of [task, promoted]) for (const level of autonomy.LEVELS) assert.equal(autonomy.needsApproval(row, { level }), true, level);
  const copy = admission.taskRow(task, { now: 3 });
  assert.equal(copy.origin.via, "remote");
  const local = admission.taskRow({ id: "local", title: "Local", origin: { kind: "chat", by: "owner", via: "made-up" } }, { now: 4 });
  assert.deepEqual(local.origin, { kind: "chat", by: "owner" });
  assert.equal(autonomy.needsApproval(local, { level: "auto" }), false);
});

test("work filed from Discord waits for the owner's OK in every mode, and so do its slices", () => {
  for (const level of ["ask", "accept", "auto", "elevated"]) {
    assert.equal(autonomy.needsApproval(remoteTask, { level, elevated: { "agent-filed": false } }), true, level);
  }
  const split = { id: "s1", projectId: "p1", title: "Part 1", splitFrom: "r1" };
  const delegated = { id: "d1", projectId: "p1", title: "Part 2", parentTaskId: "r1" };
  const parent = { ...remoteTask, delegation: { version: 1, childTaskIds: ["d1"] } };
  const tasks = [parent, split, delegated];
  assert.equal(autonomy.needsApproval(split, { level: "auto", tasks }), true);
  assert.equal(autonomy.needsApproval(delegated, { level: "auto", tasks }), true);
  const unrelated = { id: "u1", projectId: "p1", title: "Other", parentTaskId: "r1" };
  assert.equal(autonomy.remoteWork(unrelated, { tasks: [...tasks, unrelated] }), false, "naming a parent is not being its slice");
  const approved = { ...parent, buildApproval: { version: 1, scope: backlog.buildScope(parent) } };
  assert.equal(autonomy.needsApproval(approved, { level: "auto", tasks: [approved, split, delegated] }), false, "the owner's OK releases it");
  assert.equal(autonomy.needsApproval(split, { level: "auto", tasks: [approved, split, delegated] }), false, "and its slices");
  assert.equal(autonomy.needsApproval({ id: "o1", origin: { kind: "chat", by: "owner" } }, { level: "auto" }), false, "the owner's own chat work is unchanged");
});

test("every chat path narrows a Discord message (or another app's) and stamps what it files", () => {
  assert.match(main, /if \(options\?\.remote === true\) user\.remote = true;/, "assistantMessage marks a message from Discord");
  assert.match(main, /if \(typeof options\?\.app === "string" && options\.app\.trim\(\)\) \{ user\.remote = true; user\.from = "app"; user\.app = options\.app\.trim\(\)\.slice\(0, 40\); \}/, "and one from another app on this PC, by name");
  const gates = main.match(/if \(user\?\.remote && remoteRules\) checked = remoteRules\.gateActions\(checked, \{ from: user\.from \}\);/g) ?? [];
  assert.equal(gates.length, 2, "the model's turn and the keyless control both gate");
  assert.equal((main.match(/assistantChatAction\(action, \{ focused, remote: user\?\.remote === true, from: user\?\.from \?\? null \}\)/g) ?? []).length, 1);
  assert.equal((main.match(/assistantChatAction\(action, \{ remote: user\?\.remote === true, from: user\?\.from \?\? null \}\)/g) ?? []).length, 1);
  assert.match(main, /if \(user\.remote && remoteRules && !remoteRules\.LOCAL_ACTIONS\.includes\(action\)\) \{/, "the keyless reply's own actions are narrowed too");
  assert.equal((main.match(/\.\.\.\(user\.remote && remoteRules \? \{ origin: \{ \.\.\.remoteRules\.ORIGIN, \.\.\.\(user\.from === "app" \? \{ via: "app" \} : \{\}\) \} \} : \{\}\)/g) ?? []).length, 1, "keyless filing stamps the origin");
  assert.equal((main.match(/\.\.\.\(remote && remoteRules \? \{ origin: \{ \.\.\.remoteRules\.ORIGIN, \.\.\.\(from === "app" \? \{ via: "app" \} : \{\}\) \} \} : \{\}\)/g) ?? []).length, 1, "the model's create_task stamps the origin");
  assert.deepEqual([...remote.LOCAL_ACTIONS], ["pause", "resume", "queue-request"]);
});

test("the gate's refusals name where the message came from", () => {
  const checked = { run: [{ kind: "approve", taskId: "t1" }, { kind: "answer" }, { kind: "create_task", title: "x" }] };
  const discord = remote.gateActions(checked);
  assert.deepEqual(discord.run.map((action) => action.kind), ["create_task"]);
  assert.deepEqual(discord.rejected.map((row) => row.reason), ["from Discord, approve with the Approve button and your PIN, or in Studio", "from Discord this waits for you in Studio"]);
  const app = remote.gateActions(checked, { from: "app" });
  assert.deepEqual(app.run.map((action) => action.kind), ["create_task"], "an app gets exactly Discord's narrower chat");
  assert.deepEqual(app.rejected.map((row) => row.reason), ["from another app, the owner approves in Studio", "from another app this waits for the owner in Studio"]);
});

test("create_task from Discord reaches the board with the remote origin", async () => {
  const start = main.indexOf("async function assistantChatAction(");
  const end = main.indexOf("\n}\n", start) + 3;
  const created = [];
  const context = vm.createContext({
    String, Promise, JSON,
    remoteRules: remote,
    getEyes: async () => ({ readJson: async () => [] }), TASKS_PATH: "t",
    assistantCreateTask: async (fields) => { created.push(plain(fields)); return { created: { id: "t9", title: fields.title } }; },
    assistantAskForWork: () => {},
  });
  vm.runInContext(`${main.slice(start, end)}\nthis.run = assistantChatAction;`, context);
  await context.run({ kind: "create_task", title: "Add dark mode", ownerText: "Add dark mode please" }, { remote: true });
  await context.run({ kind: "create_task", title: "Tidy menus", ownerText: "Tidy menus" });
  await context.run({ kind: "create_task", title: "Add search", ownerText: "Add search" }, { remote: true, from: "app" });
  assert.deepEqual(created[0].origin, { kind: "chat", by: "owner", via: "remote" });
  assert.equal(created[1].origin, undefined, "from Studio the chat default stands");
  assert.deepEqual(created[2].origin, { kind: "chat", by: "owner", via: "app" }, "from another app it says so");
});

test("the bridge sends the PIN one way and only the fields main reads", async () => {
  const invoked = [], listeners = [];
  const page = {
    require: () => ({
      contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) },
      ipcRenderer: { invoke: async (channel, ...args) => { invoked.push({ channel, args: plain(args) }); return { ok: true }; }, on: (channel) => listeners.push(channel) },
    }),
  };
  vm.runInNewContext(preloadSource, page);
  const api = page.mefiStudio;
  await api.remoteStatus();
  await api.remoteSet({ on: true, name: "x".repeat(60), notify: { done: "yes", digestHour: 20, extra: 1 }, quiet: { from: "23:00", to: "07:00", more: 1 }, pin: "1234" });
  await api.remoteSet({ quiet: null });
  await api.remotePin({ pin: "12345678901234", clear: "no", other: 1 });
  await api.remotePin({ unlock: true });
  api.onRemoteEvent(() => {});
  assert.deepEqual(invoked, [
    { channel: "remote:status", args: [] },
    { channel: "remote:set", args: [{ on: true, name: "x".repeat(40), notify: { done: false, digestHour: 20 }, quiet: { from: "23:00", to: "07:00" } }] },
    { channel: "remote:set", args: [{ quiet: null }] },
    { channel: "remote:pin", args: [{ pin: "123456789012" }] },
    { channel: "remote:pin", args: [{ unlock: true }] },
  ], "no PIN rides a settings save, and nothing unnamed crosses");
  assert.ok(listeners.includes("remote:event"));
  assert.match(main, /ipcMain\.handle\("remote:status", async \(\) => remoteStatus\(\)\);/);
  assert.match(main, /const APP_WIDE_PREFIXES = \[[^\]]*"remote:"/, "the remote belongs to this PC, not to the open project");
});
