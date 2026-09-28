// Your PCs shows what each PC's agents are doing (main.cjs "Your PCs vault":
// agentsSnapshot, vaultAgentsLine, vaultHeartbeat, vaultAgentsWatch). The
// snapshot reads the loop status, the running jobs, the companion's needs-you
// count and today's work events; the line keeps counts and clipped titles; a
// heartbeat goes after a sync look and when the agents' line changed, never
// more than once in ten minutes.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const from = main.indexOf("// This PC's agents in one read");
const to = main.indexOf("// ---- friend shares (.mefishare) ----", from);
assert.ok(from > 0 && to > from, "main.cjs has the agents line in its vault block");
const block = main.slice(from, to);
const plain = (value) => JSON.parse(JSON.stringify(value));
const MINUTE = 60000;

function host({ jobs = [], tasks = [], events = [], needs = { total: 0, items: [] }, loop = { state: "running", headline: "1 agent working" }, now = Date.UTC(2026, 8, 28, 15) } = {}) {
  const beats = [];
  const clock = { now };
  const context = vm.createContext({
    JSON, Date: class extends Date { constructor(...args) { super(...(args.length ? args : [clock.now])); } static now() { return clock.now; } }, Number, String, Array, Math, Promise,
    SMOKE: false, CAPTURE: false, CLI_MODE: false,
    VAULT_HEARTBEAT_MS: 10 * MINUTE, vaultHeartbeatAt: 0, vaultLines: new Map(),
    autopilot: { jobs },
    autopilotLoop: () => ({ ...loop, on: true, running: jobs.filter((job) => !job.finished).length }),
    executorActivity: require("../scripts/executor-activity.cjs"),
    companionModule: require("../scripts/companion.cjs"),
    assistantNeedsYouDigest: async () => needs,
    getEyes: async () => ({ readJson: async () => tasks }),
    TASKS_PATH: "tasks.json",
    agentBrain: { events: async ({ since }) => ({ ok: true, events: events.filter((row) => row.at >= since) }) },
    projects: { open: () => ({ name: "Ruins Runner" }) },
    vaultProjectRepo: async () => "owner/ruins-runner",
    vault: () => ({ heartbeat: async (projects, agents) => { beats.push(plain({ projects, agents })); return { ok: true }; } }),
    setInterval: () => ({ unref() {} }),
  });
  vm.runInContext(`${block}\nthis.api = { agentsSnapshot, vaultAgentsLine, vaultHeartbeat, vaultAgentsWatch, sent: () => vaultAgentsSent };`, context);
  return { api: context.api, context, beats, clock, jobs, needs };
}

test("the snapshot says what is being built, what waits on the owner and what finished today", async () => {
  const now = Date.UTC(2026, 8, 28, 15);
  const midnight = new Date(now); midnight.setHours(0, 0, 0, 0);
  const h = host({
    now,
    jobs: [
      { title: "  Add   the login page ", startedAt: now - 5 * MINUTE, finished: false, todos: [{ status: "in_progress", content: "Write the form" }] },
      { title: "Old run", startedAt: now - 60 * MINUTE, finished: true },
    ],
    tasks: [{ id: "t1", title: "Fix the tests", status: "done", doneAt: now - 30 * MINUTE }, { id: "t2", title: "Yesterday's work", status: "done", doneAt: midnight.getTime() - MINUTE }],
    events: [{ kind: "stage", stage: "failed", taskId: "t3", title: "Port the shaders", at: now - 10 * MINUTE }],
    needs: { total: 2, items: [{ kind: "approval", title: "Ship it" }, { kind: "question", title: "Which font?" }] },
  });
  const snapshot = await h.api.agentsSnapshot(now);
  assert.deepEqual(plain(snapshot), {
    at: now, project: "Ruins Runner", state: "running", headline: "1 agent working",
    working: [{ title: "Add the login page", since: now - 5 * MINUTE, step: "Write the form" }],
    needsYou: 2, needs: [{ kind: "approval", title: "Ship it" }, { kind: "question", title: "Which font?" }],
    done: ["Fix the tests"], failed: ["Port the shaders"],
  });
  assert.deepEqual(plain(h.api.vaultAgentsLine(snapshot)), {
    project: "Ruins Runner", state: "running", headline: "1 agent working",
    working: [{ title: "Add the login page", since: now - 5 * MINUTE }],
    needsYou: 2, done: 1, failed: 1, recent: ["Fix the tests"],
  }, "the vault line has no steps and no needs-you titles: counts and what is built");
});

test("a board that cannot be read gives no snapshot, and the heartbeat still goes", async () => {
  const h = host();
  h.context.getEyes = async () => { throw new Error("locked"); };
  assert.equal(await h.api.agentsSnapshot(), null);
  await h.api.vaultHeartbeat({ risk: [1], state: { behind: 2 } });
  assert.deepEqual(h.beats, [{ projects: [{ repo: "owner/ruins-runner", risk: 1, behind: 2 }], agents: null }]);
});

test("a heartbeat goes after a sync look, keeps the project lines, and waits ten minutes", async () => {
  const h = host({ jobs: [{ title: "Add the login page", startedAt: 1, finished: false }] });
  await h.api.vaultHeartbeat({ risk: [], state: { behind: 3 } });
  assert.equal(h.beats.length, 1);
  assert.deepEqual(h.beats[0].projects, [{ repo: "owner/ruins-runner", risk: 0, behind: 3 }]);
  assert.equal(h.beats[0].agents.working[0].title, "Add the login page");
  await h.api.vaultHeartbeat({ risk: [], state: { behind: 0 } });
  assert.equal(h.beats.length, 1, "inside ten minutes nothing more goes");
  h.clock.now += 11 * MINUTE;
  await h.api.vaultHeartbeat();
  assert.deepEqual(h.beats[1].projects, [{ repo: "owner/ruins-runner", risk: 0, behind: 3 }], "a heartbeat without a look keeps the last project lines");
});

test("the watch sends only when the agents changed, never before the first sync look, and never faster", async () => {
  const h = host({ jobs: [{ title: "Add the login page", startedAt: 1, finished: false }] });
  await h.api.vaultAgentsWatch();
  assert.equal(h.beats.length, 0, "the first line comes with the first sync look");
  await h.api.vaultHeartbeat({ risk: [], state: { behind: 0 } });
  h.clock.now += 11 * MINUTE;
  await h.api.vaultAgentsWatch();
  assert.equal(h.beats.length, 1, "nothing changed: nothing is sent");
  h.jobs[0].finished = true;
  h.jobs.push({ title: "Fix the tests", startedAt: h.clock.now, finished: false });
  h.needs.total = 1;
  await h.api.vaultAgentsWatch();
  assert.equal(h.beats.length, 2);
  assert.deepEqual(h.beats[1].agents.working.map((row) => row.title), ["Fix the tests"]);
  assert.equal(h.beats[1].agents.needsYou, 1);
  h.jobs.push({ title: "Third", startedAt: h.clock.now, finished: false });
  await h.api.vaultAgentsWatch();
  assert.equal(h.beats.length, 2, "a change inside ten minutes waits for the next look");
});
