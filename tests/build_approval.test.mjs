import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import backlog from "../scripts/backlog.cjs";
import ideaActions from "../scripts/idea-actions.cjs";
import { executorHost } from "./fixtures/host_executor.mjs";

const { applyRequestAction } = ideaActions;
const task = (id, extra = {}) => ({ id, title: `Build ${id}`, prompt: `Implement ${id} within its saved scope`, status: "open", files: [`${id}.js`], createdAt: 1, ...extra });
const approve = (h, id) => h.env.backlogControl({ action: "approve", projectId: "fixture", taskId: id, expectedScope: backlog.buildScope(h.board().tasks.find((row) => row.id === id)) });

test("deferred work cannot dispatch until its date and still requires reviewed approval", async () => {
  const h = executorHost({ tasks: [task("later")], autoBuild: false });
  h.edit((board) => { board.tasks[0].deferUntil = h.now() + 60000; });
  await approve(h, "later");
  await h.env.spawnNextJob();
  assert.equal(h.starts.length, 0);
  h.advance(60000);
  assert.equal(await h.env.spawnNextJob(), "spawned");
  assert.equal(h.starts[0].taskId, "later");
});

test("Auto build keeps existing dispatch; Verify first holds both a board task and a promoted inbox request", async () => {
  const automatic = executorHost({ tasks: [task("automatic")] });
  assert.equal(await automatic.env.spawnNextJob(), "spawned");
  // Only tasks run: the inbox request reaches the executor through the
  // foreman's promotion, and its card waits for approval like any other.
  for (const options of [{ tasks: [task("held")] }, { requests: [{ at: 1, title: "Inbox request", prompt: "Change direct.js", files: ["direct.js"] }] }]) {
    const h = executorHost({ ...options, autoBuild: false });
    h.wake(); await h.pump();
    assert.equal(h.board().tasks.length, 1);
    assert.equal(h.starts.length, 0);
    assert.equal(h.registry.size, 0);
    assert.match(h.autopilot.waiting, /approval/i);
    const status = await h.env.backlogStatus();
    assert.equal(status.counts.approval, 1);
    assert.equal(status.counts.ready, 0);
    assert.equal(status.autoBuild, false);
    assert.equal(status.approval[0].canApprove, true);
  }
});

test("approving a viewed task starts only that task, even with free parallel slots", async () => {
  const h = executorHost({ tasks: [task("chosen"), task("unreviewed")], autoBuild: false, parallel: 3 });
  assert.equal(h.env.taskView(h.board().tasks[0]).buildScope, backlog.buildScope(h.board().tasks[0]));
  assert.equal((await approve(h, "chosen")).ok, true);
  await h.pump();
  assert.deepEqual(h.starts.map((row) => row.taskId), ["chosen"]);
  assert.equal(h.board().tasks.find((row) => row.id === "unreviewed").status, "open");
  assert.equal(backlog.hasBuildApproval(h.board().tasks.find((row) => row.id === "chosen")), true);
});

test("approval rejects stale, missing and foreign-project scope without queuing a worker", async () => {
  const h = executorHost({ tasks: [task("changed")], autoBuild: false });
  const expectedScope = backlog.buildScope(h.board().tasks[0]);
  h.edit((board) => { board.tasks[0].prompt = "A larger, different build"; });
  for (const payload of [{ expectedScope }, {}, { projectId: "another", expectedScope: backlog.buildScope(h.board().tasks[0]) }]) {
    const result = await h.env.backlogControl({ action: "approve", projectId: "fixture", taskId: "changed", ...payload });
    assert.equal(result.ok, false);
  }
  await h.pump();
  assert.equal(h.starts.length, 0);
  assert.equal(h.board().tasks[0].buildApproval, undefined);
});

test("approval is tied to identity, requirements, files, dependencies and nested grouped scope", () => {
  const original = task("scope", { refs: [{ kind: "file", detail: "scope.js" }], dependsOn: [], members: [{ id: "member", prompt: "Original member" }] });
  original.buildApproval = { version: 1, scope: backlog.buildScope(original), approvedAt: 12 };
  assert.equal(backlog.hasBuildApproval({ ...original, status: "active", runId: "run", updatedAt: 500, logs: [{ text: "Claimed" }] }), true);
  for (const patch of [
    { id: "copy" }, { prompt: "Changed" }, { files: ["another.js"] }, { dependsOn: ["dependency"] },
    { refs: [{ kind: "file", detail: "other.js" }] }, { members: [{ id: "member", prompt: "Expanded member" }] },
    { requirements: ["New requirement"] }, { remaining: ["New delegated work"] }, { acceptanceCriteria: ["Changed check"] },
  ]) assert.equal(backlog.hasBuildApproval({ ...original, ...patch }), false, JSON.stringify(patch));
});

test("a reference gather landing after approval keeps it; web rows and owner rows still count as scope", () => {
  const fresh = task("gathered");
  const approved = { ...fresh, buildApproval: { version: 1, scope: backlog.buildScope(fresh), approvedAt: 12 } };
  const gathered = [
    { kind: "file", title: "gathered.js", detail: "work tree", auto: true },
    { kind: "session", title: "Earlier chat", detail: "s1", auto: true },
    { kind: "context", title: "Start with gathered.js", detail: "Picked from local matches", auto: true },
  ];
  // The card had no refs when it was approved; the gather adds only analyzer rows.
  assert.equal(backlog.hasBuildApproval({ ...approved, refs: gathered }), true);
  // A named Start keyed on the scope survives the same gather.
  assert.equal(backlog.buildScope({ ...fresh, refs: gathered.slice(0, 1) }), backlog.buildScope(fresh));
  // Outside links and anything the owner wrote are still reviewed scope.
  assert.equal(backlog.hasBuildApproval({ ...approved, refs: [...gathered, { kind: "web", title: "A page", detail: "https://example.com", auto: true }] }), false);
  assert.equal(backlog.hasBuildApproval({ ...approved, refs: [{ kind: "file", title: "owner.js", detail: "work tree" }] }), false);
  // A card approved with an owner ref keeps it in scope; gathered rows beside it do not count.
  const withOwnerRef = task("mixed", { refs: [{ kind: "file", title: "owner.js" }] });
  const mixed = { ...withOwnerRef, buildApproval: { version: 1, scope: backlog.buildScope(withOwnerRef), approvedAt: 12 } };
  assert.equal(backlog.hasBuildApproval({ ...mixed, refs: [...withOwnerRef.refs, ...gathered] }), true);
  assert.equal(backlog.hasBuildApproval({ ...mixed, refs: gathered }), false);
});

test("a card made with refs: [] keeps its approval and named Start when a gather lands", () => {
  // work-admission's taskRow gives every new card an empty refs list, which
  // is part of the scope the owner approved.
  const fresh = task("row", { refs: [] });
  const approved = { ...fresh, buildApproval: { version: 1, scope: backlog.buildScope(fresh), approvedAt: 12 } };
  const gathered = [
    { kind: "file", title: "gathered.js", detail: "work tree", auto: true },
    { kind: "context", title: "Start with gathered.js", detail: "Picked from local matches", auto: true },
  ];
  assert.equal(backlog.hasBuildApproval({ ...approved, refs: gathered }), true);
  assert.equal(backlog.scopeMatches({ ...fresh, refs: gathered }, backlog.buildScope(fresh)), true, "a named Start keyed on the scope survives");
  // Anything that is not a gathered row still changes the scope.
  assert.equal(backlog.hasBuildApproval({ ...approved, refs: [...gathered, { kind: "web", title: "A page", detail: "https://example.com", auto: true }] }), false);
  assert.equal(backlog.hasBuildApproval({ ...approved, refs: [{ kind: "file", title: "owner.js", detail: "work tree" }] }), false);
  assert.equal(backlog.hasBuildApproval({ ...approved, refs: gathered, prompt: "Something else" }), false);
  assert.equal(backlog.scopeMatches(fresh, ""), false);
  assert.equal(backlog.scopeMatches(fresh, undefined), false);
});

test("a named Start survives a gather through selection and the host's lost check", async () => {
  const h = executorHost({ tasks: [task("named", { refs: [] })], autoBuild: false });
  await approve(h, "named");
  h.edit((board) => { board.tasks[0].refs = [{ kind: "file", title: "found.js", detail: "work tree", auto: true }]; });
  const card = h.board().tasks[0];
  assert.equal(backlog.hasBuildApproval(card), true, "the approval outlived the gather");
  const executorCore = (await import("../scripts/executor-core.cjs")).default;
  const picked = executorCore.selectCandidates({
    tasks: [card], now: h.now(), liveTaskIds: new Set(), liveKeys: new Set(), titleKey: (title) => title, conflicts: () => false,
    autoBuild: false, taskStart: { taskId: "named", scope: backlog.buildScope({ ...card, refs: [] }) }, compare: () => 0,
  });
  assert.deepEqual(picked.ranked.map((candidate) => candidate.ref.id), ["named"]);
  assert.equal(await h.env.spawnNextJob(), "spawned");
  assert.equal(h.starts[0].taskId, "named");
});

test("approvals saved before gathered refs were stamped still match", () => {
  // Rows written before the auto stamp hash as they always did, including an
  // explicit empty list, so no stored approval is cancelled by the change.
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((name) => [name, canonical(value[name])])) : value;
  for (const refs of [[], [{ kind: "file", title: "old.js", detail: "work tree" }], [{ kind: "web", title: "Old page", detail: "https://example.com" }]]) {
    const saved = task("legacy", { refs });
    const legacy = Object.fromEntries(["id", "title", "prompt", "refs", "files"].map((name) => [name, saved[name]]));
    assert.equal(backlog.buildScope(saved), createHash("sha256").update(JSON.stringify(canonical(legacy))).digest("hex"), JSON.stringify(refs));
  }
});

test("approved scope survives restart but approval never resumes Pause", async () => {
  const first = executorHost({ tasks: [task("saved")], autoBuild: false, paused: true, execute: false });
  assert.equal((await approve(first, "saved")).ok, true);
  await first.pump();
  assert.equal(first.starts.length, 0);
  assert.equal(first.state.status, "paused");
  assert.equal(first.autopilot.execute, false);
  const restarted = executorHost({ tasks: first.board().tasks, autoBuild: false });
  assert.equal(await restarted.env.spawnNextJob(), "spawned");
});

test("manual retry revokes approval while retaining evidence for a fresh review", async () => {
  const h = executorHost({ tasks: [task("retry", { lastAttempt: { result: "prior evidence" } })], autoBuild: false, paused: true });
  await approve(h, "retry");
  const result = await h.env.backlogControl({ action: "retry", projectId: "fixture", taskId: "retry" });
  assert.equal(result.ok, true);
  assert.equal(h.board().tasks[0].buildApproval, undefined);
  assert.equal(h.board().tasks[0].lastAttempt.result, "prior evidence");
  assert.equal(result.backlog.counts.approval, 1);
});

test("changing to Verify first during selection or after the durable claim prevents process creation", async () => {
  for (const stage of ["selection", "claim", "lease", "final-read"]) {
    const h = executorHost({ tasks: [task(stage)] });
    if (stage === "selection") h.env.resolveActivePolicyIdentity = async () => { h.autopilot.autoBuild = false; return null; };
    if (stage === "claim") {
      const mutate = h.env.mutateBoard;
      h.env.mutateBoard = async (fn) => { h.autopilot.autoBuild = false; return mutate(fn); };
    }
    if (stage === "lease") {
      let reads = 0;
      h.env.getMachine = async () => ({ workerCapacity: async () => ({ canStart: true }), leaseStatus: async () => { if (++reads === 2) h.autopilot.autoBuild = false; return { exclusive: false }; } });
    }
    if (stage === "final-read") {
      const eyes = await h.env.getEyes();
      const read = eyes.readJson;
      let reads = 0;
      eyes.readJson = async (key, fallback) => { if (key === "tasks" && ++reads === 2) h.autopilot.autoBuild = false; return read(key, fallback); };
    }
    await h.env.spawnNextJob();
    assert.equal(h.starts.length, 0, stage);
    assert.equal(h.registry.size, 0, stage);
    assert.equal(h.board().tasks[0].status, "open", stage);
    assert.equal(h.board().tasks[0].runId, undefined, stage);
  }
});

test("scope changed after claim is reread before spawn and cannot use stale approval", async () => {
  const h = executorHost({ tasks: [task("late-edit")], autoBuild: false });
  await approve(h, "late-edit");
  let reads = 0;
  h.env.getMachine = async () => ({ workerCapacity: async () => ({ canStart: true }), leaseStatus: async () => {
    if (++reads === 2) h.edit((board) => { board.tasks[0].prompt = "Unreviewed replacement"; });
    return { exclusive: false };
  } });
  assert.ok(["lost", "empty"].includes(await h.env.spawnNextJob()));
  assert.equal(h.starts.length, 0);
  assert.equal(h.registry.size, 0);
  assert.equal(h.board().tasks[0].status, "open");
});

test("Verify first lets existing workers finish while generated handoffs await separate approval", async () => {
  const h = executorHost({ tasks: [task("parent"), task("next")], parallel: 1 });
  assert.equal(await h.env.spawnNextJob(), "spawned");
  await h.env.setAutopilot({ autoBuild: false });
  assert.equal(h.autopilot.jobs.length, 1);
  await h.finish("parent", { lines: ["MEFI_NEXT: Follow-up child :: Implement child.js", "MEFI_JOB_DONE"] });
  await h.pump();
  assert.equal(h.starts.length, 1);
  const child = h.board().tasks.find((row) => row.handoffId);
  assert.ok(child, "the delegated work remains visible on its own card");
  assert.equal(backlog.workState(child, h.now(), { tasks: h.board().tasks, autoBuild: false }).stage, "approval");
});

test("a breaker cooldown cannot bypass Verify first", async () => {
  const h = executorHost({ tasks: [task("breaker")], autoBuild: false, execute: false });
  h.autopilot.parkedUntil = h.now() - 1;
  await h.env.executeNextRequest();
  assert.equal(h.starts.length, 0);
  assert.equal(h.autopilot.autoBuild, false);
  assert.match(h.autopilot.waiting, /approval/i);
});

test("saved mode persists, existing installations default on, and a failed save cannot enable Auto build", async () => {
  for (const savedSettings of [{}, { ui: { autopilot: { execute: false } } }, { ui: { autopilot: { autoBuild: false } } }]) {
    const h = executorHost({ savedSettings });
    await h.env.bootAutopilot();
    assert.equal(h.autopilot.autoBuild, savedSettings.ui?.autopilot?.autoBuild !== false);
    assert.equal(h.settings().ui.autopilot.autoBuild, h.autopilot.autoBuild);
  }
  const h = executorHost({ autoBuild: false, tasks: [task("failed-save")] });
  h.env.writeSettings = async () => { throw new Error("settings unavailable"); };
  await assert.rejects(h.env.setAutopilot({ autoBuild: true }), /settings unavailable/);
  assert.equal(h.autopilot.autoBuild, false);
  await h.env.executeNextRequest();
  assert.equal(h.starts.length, 0);
});

test("the old Auto build switch keeps a permission mode it cannot name", async () => {
  // [saved level, Auto build choice, level afterwards]
  for (const [level, autoBuild, expected] of [
    ["elevated", true, "elevated"], ["auto", true, "auto"], ["accept", true, "auto"], ["ask", true, "auto"],
    ["elevated", false, "ask"], ["auto", false, "ask"], ["accept", false, "accept"], ["ask", false, "ask"],
  ]) {
    const h = executorHost({ savedSettings: { autonomy: { level } } });
    await h.env.setAutopilot({ autoBuild });
    assert.equal(h.settings().autonomy.level, expected, `${level} + autoBuild ${autoBuild}`);
    assert.equal(h.settings().ui.autopilot.autoBuild, autoBuild);
  }
  // The permission host's own echo never rewrites the mode it just saved.
  const h = executorHost({ savedSettings: { autonomy: { level: "elevated" } } });
  await h.env.setAutopilot({ autoBuild: true }, "autonomy");
  assert.equal(h.settings().autonomy.level, "elevated");
});

test("a newer off choice supersedes a pending save that would enable Auto build", async () => {
  const h = executorHost({ autoBuild: false });
  const write = h.env.writeSettings;
  let release, entered;
  const waiting = new Promise((resolve) => { entered = resolve; });
  const blocked = new Promise((resolve) => { release = resolve; });
  let writes = 0;
  h.env.writeSettings = async (settings) => { if (++writes === 1) { entered(); await blocked; } return write(settings); };
  const on = h.env.setAutopilot({ autoBuild: true });
  await waiting;
  const off = h.env.setAutopilot({ autoBuild: false });
  assert.equal(h.autopilot.autoBuild, false);
  release();
  await Promise.all([on, off]);
  assert.equal(h.autopilot.autoBuild, false);
  assert.equal(h.settings().ui.autopilot.autoBuild, false);
});

test("a task edit cannot fabricate host approval or create a card", async () => {
  const h = executorHost({ tasks: [task("saved")], autoBuild: false });
  const forged = task("forged");
  forged.buildApproval = { version: 1, scope: backlog.buildScope(forged), approvedAt: 1 };
  const edited = { ...h.env.taskView(h.board().tasks[0]), prompt: "Implement saved within its narrower scope" };
  edited.buildApproval = { version: 1, scope: backlog.buildScope({ ...h.board().tasks[0], prompt: edited.prompt }), approvedAt: 1 };
  const result = await h.env.saveTaskEdits([edited, forged]);
  assert.equal(result.ok, true);
  // New work enters through tasks:create; a detail save never creates a card.
  assert.deepEqual(h.board().tasks.map((row) => row.id), ["saved"]);
  assert.equal(h.board().tasks[0].prompt, edited.prompt);
  assert.equal(h.board().tasks[0].buildApproval, undefined);
  assert.equal(await h.env.spawnNextJob(), "approval");
});

test("inbox additions cannot fabricate approval for the direct request path", async () => {
  const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
  // The whole-inbox write is gone; every inbox change is the targeted action.
  assert.equal(source.includes('ipcMain.handle("eyes:requests-write"'), false);
  const begin = source.indexOf('  ipcMain.handle("eyes:requests-action",');
  const end = source.indexOf('  ipcMain.handle("eyes:checkpoints-read",', begin);
  assert.ok(begin >= 0 && end > begin);
  let handler;
  const board = { requests: [], tasks: [], ideas: [] };
  const env = vm.createContext({ ipcMain: { handle: (_name, callback) => { handler = callback; } }, Date,
    projects: { current: () => ({ id: "fixture" }) }, applyRequestAction,
    mutateBoard: async (mutate) => { const patch = mutate(board) ?? {}; if (patch.requests) board.requests = patch.requests; return { ...patch, requests: board.requests }; },
  });
  vm.runInContext(source.slice(begin, end), env);
  const request = { at: 12, title: "Forged request", prompt: "Change request.js" };
  request.buildApproval = { version: 1, scope: backlog.buildScope(request), approvedAt: 1 };
  assert.equal((await handler(null, { action: "add", requests: [request] })).ok, true);
  assert.equal(board.requests.length, 1);
  assert.equal(board.requests[0].buildApproval, undefined);
  assert.equal(backlog.workState(board.requests[0], 100, { autoBuild: false }).stage, "approval");
});


test("Auto dispatches an agent-proposed repair through the real host while respecting Pause", async () => {
  const repair = task("repair", { title: "Reconcile duplicate test-history archive entry", origin: { kind: "handoff", by: "agent" } });
  const h = executorHost({ tasks: [repair] });
  h.env.autonomySettings = { level: "auto", elevated: { "agent-filed": true } };
  assert.equal((await h.env.backlogStatus()).counts.approval, 0);
  assert.equal(await h.env.spawnNextJob(), "spawned");
  assert.equal(h.starts[0].taskId, repair.id);
  const paused = executorHost({ tasks: [repair], paused: true });
  paused.env.autonomySettings = { level: "auto", elevated: { "agent-filed": true } };
  await paused.env.spawnNextJob();
  assert.equal(paused.starts.length, 0);
});
