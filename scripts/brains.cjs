// Mefi's Studio AI+ — brain maps: the engine's pipeline written down as a
// graph you can open, rewire and save.
//
// The loop already had a pipeline — an idea or a request is checked, analysed,
// planned, briefed, reviewed by the assistant, set up for Jev, routed to a
// model, built and verified — but it only existed as the order of calls inside
// main.cjs. A brain map is that same pipeline as data: typed nodes, typed
// ports, wires between them, and per-node permission, model and settings.
//
// Two honest halves, and the catalog says which is which per node (`runs`):
//
//   runs: "host"  the host already performs this stage. The node configures
//                 it, and activating a map moves the real switch behind it
//                 (see GATES) — nothing else about that stage is re-routed.
//   runs: "map"   the map decides it outright: issue triage, whether a
//                 decision reaches you, and what the card offers.
//   runs: "draft" saved, validated and drawn, but nothing executes it yet.
//
// A node may also BE another map (`brain.call`), which is what makes a map a
// brain rather than a diagram: the inner map's triage and ask rules apply to
// whatever is routed into it.
//
// A setting marked `wired: true` is one the host really reads. The rest are
// held on the map and drawn, and the editor says so beside each of them. The
// same goes for a part's model block: nothing reads it yet, so no catalog
// entry marks its `model` wired.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const issues = require("./agent-issues.cjs");

const SCHEMA = 1;
const MAX_NODES = 120;
const MAX_EDGES = 240;
const MAX_MAPS = 24;
const MAX_NEST = 4;
// The build worker limit the studio enforces (main.cjs EXECUTOR_PARALLEL_CAP):
// a map may ask for fewer workers, never more.
const MAX_PARALLEL = 3;
const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const CONTROL = /[\u0000-\u001f\u007f]/g;

const clean = (value, limit) => String(value ?? "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, limit);
const coord = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(-4000, Math.min(4000, Math.round(number))) : 0;
};

// ---- what a node may be allowed to do ---------------------------------------
// One list, shown in the inspector and enforced as a map-level grant: a node
// that needs reach the map has not granted is an error, not a silent widening.

const PERMISSIONS = [
  { key: "read-project", label: "Read the project", detail: "Open files, the board and the task history for the open project." },
  { key: "write-files", label: "Write project files", detail: "Change files in the project folder." },
  { key: "run-commands", label: "Run commands", detail: "Run builds, tests and named checks." },
  { key: "spawn-worker", label: "Start a worker", detail: "Dispatch a CLI agent that works on its own." },
  { key: "spend-model-calls", label: "Spend model calls", detail: "Make paid model calls on your accounts." },
  { key: "network", label: "Reach the network", detail: "Make requests outside this machine." },
  { key: "change-settings", label: "Change Studio settings", detail: "Move switches such as routing, approval or the worker pool." },
  { key: "message-user", label: "Message you", detail: "Write into the assistant thread." },
  { key: "create-task", label: "Create work", detail: "Put new cards on the board." },
  { key: "close-task", label: "Close work", detail: "Mark work done, park it or archive it." },
];
const PERMISSION_KEYS = PERMISSIONS.map((permission) => permission.key);

// ---- what flows along a wire ------------------------------------------------

const PORT_KINDS = [
  { kind: "idea", label: "Idea", detail: "A rough thought, not yet work." },
  { kind: "request", label: "Request", detail: "Something asked for, admitted to the inbox." },
  { kind: "analysis", label: "Analysis", detail: "What the request needs before it can be planned." },
  { kind: "plan", label: "Plan", detail: "Steps and decisions, reviewable before any build." },
  { kind: "brief", label: "Brief", detail: "The scoped instruction one worker is given." },
  { kind: "jev-request", label: "Jev question", detail: "The candidates and evidence Jev is asked about." },
  { kind: "values", label: "Values", detail: "What Jev reported back: its choice and the evidence behind it." },
  { kind: "route", label: "Route", detail: "The provider and model this work is dispatched on." },
  { kind: "run", label: "Run", detail: "A live worker and everything it prints." },
  { kind: "verdict", label: "Verdict", detail: "Verified, unverified or failed, with its evidence." },
  { kind: "issue", label: "Issue", detail: "An agent saying something needs a decision." },
  { kind: "ask", label: "Ask", detail: "A decision on its way to you." },
  { kind: "answer", label: "Answer", detail: "What you or the assistant decided." },
  { kind: "rejected", label: "Rejected", detail: "Turned away, with the reason kept." },
  { kind: "any", label: "Anything", detail: "Accepts or emits whatever the other end carries." },
];
const PORT_KIND_IDS = PORT_KINDS.map((port) => port.kind);

const GROUPS = [
  { id: "intake", label: "Intake", detail: "Where work comes from." },
  { id: "check", label: "Checks", detail: "Whether an ask is real and well formed." },
  { id: "plan", label: "Planning", detail: "Turning an ask into a plan and a brief." },
  { id: "assistant", label: "Assistant", detail: "The review and hand-off in the middle." },
  { id: "routing", label: "Routing", detail: "Jev's values and the model that gets chosen." },
  { id: "build", label: "Build", detail: "Dispatch and verification." },
  { id: "decide", label: "Decisions", detail: "Issues, triage and what reaches you." },
  { id: "control", label: "Control", detail: "Branching, nested brains and notes." },
];

// Gates: the real switches activating a map moves. Everything else a node
// configures stays advisory until its stage is re-routed through the map.
const GATES = {
  approveBeforeBuild: { label: "Verify before build", setting: "autopilot.autoBuild", node: "check.user",
    detail: "A saved task scope waits for your approval before any worker starts." },
  briefing: { label: "AI briefs on the tick", setting: "assistant.prefs.proactive", node: "brief.write",
    detail: "Each pass may spend a call to write a brief for what it found." },
  jev: { label: "Jev routing", setting: "settings.jevShadow", node: "jev.classify",
    detail: "Jev classifies work and reports values the model choice is made from." },
  modelChoice: { label: "Model choice", setting: "settings.modelSelection", node: "model.pick",
    detail: "Auto compares candidates per task; Fixed keeps your saved defaults." },
  dispatch: { label: "Dispatch", setting: "autopilot.execute", node: "work.dispatch",
    detail: "Whether ready work is handed to workers at all." },
  parallel: { label: "Workers at once", setting: "autopilot.parallel", node: "work.dispatch",
    detail: `How many builds may run together — the build worker limit, at most ${MAX_PARALLEL}.` },
};

// ---- the catalog -------------------------------------------------------------

const port = (id, label, kinds, extra = {}) => ({ id, label, kinds, ...extra });

const NODE_TYPES = [
  {
    type: "idea.planner", label: "Idea planner", group: "intake", runs: "host", glyph: "g-ideas",
    summary: "Reads recent chats and the project for ideas worth doing, and writes them to the idea inbox.",
    can: ["Read chats, the project map and the board", "Write unread ideas to the inbox", "Rank what it found"],
    cannot: ["Start work", "Change files", "Close anything"],
    permissions: ["read-project", "spend-model-calls"],
    model: { uses: true, role: "routine" },
    inputs: [],
    outputs: [port("idea", "Idea", ["idea"])],
    settings: [
      { key: "cadence", type: "enum", label: "How often", options: ["off", "every-tick", "hourly", "daily"], default: "daily",
        help: "How often the scan runs when the loop is awake." },
      { key: "perPass", type: "number", label: "Ideas per pass", default: 3, min: 1, max: 10,
        help: "Caps how many new ideas one scan may add." },
    ],
    hostNote: "The ideas roster role already does this; it keeps its own cadence, not these settings yet.",
  },
  {
    type: "user.request", label: "You ask for it", group: "intake", runs: "host", glyph: "g-command",
    summary: "The thread, the Command composer and the board box: work you asked for by hand.",
    can: ["Create a request or a task from what you typed", "Pin it ahead of generated work"],
    cannot: ["Be turned off — your own asks always reach the board"],
    permissions: ["create-task"],
    model: null,
    inputs: [],
    outputs: [port("request", "Request", ["request"])],
    settings: [
      { key: "pin", type: "boolean", label: "Pin what you ask for", default: true,
        help: "Your own asks sort ahead of work the loop found by itself." },
    ],
    singleton: true,
    hostNote: "assistantCreateTask already does this. Removing the part turns nothing off: your own asks always reach the board.",
  },
  {
    type: "inbox.request", label: "Request inbox", group: "intake", runs: "host", glyph: "g-explorer",
    summary: "Handoffs, audits and collision reports other agents queued as requests.",
    can: ["Admit queued requests", "Deduplicate against work already on the board"],
    cannot: ["Invent work of its own"],
    permissions: ["read-project", "create-task"],
    model: null,
    inputs: [],
    outputs: [port("request", "Request", ["request"])],
    settings: [
      { key: "promote", type: "boolean", label: "Promote to tasks", default: true,
        help: "Requests become board tasks on the tick instead of sitting in the inbox." },
    ],
    hostNote: "promoteRequestsToTasks runs this on every tick.",
  },
  {
    type: "check.user", label: "You verify it", group: "check", runs: "host", glyph: "g-tasks",
    summary: "A saved task scope waits for your approval before anything builds it.",
    can: ["Hold work at the approval stage", "Show the exact scope being approved"],
    cannot: ["Approve on your behalf", "Expire an approval by itself"],
    permissions: [],
    model: null,
    inputs: [port("in", "Work", ["idea", "request", "plan", "brief"], { required: true })],
    outputs: [port("approved", "Approved", ["request", "plan", "brief"]), port("rejected", "Turned away", ["rejected"])],
    settings: [
      { key: "scope", type: "enum", label: "What needs approval", options: ["everything", "generated-only"], default: "everything",
        help: "Everything holds all work; generated-only lets what you asked for through." },
    ],
    gate: "approveBeforeBuild",
    hostNote: "Present, this turns Verify-first on (autopilot.autoBuild = false). Removed, work builds without waiting.",
  },
  {
    type: "check.model", label: "A model checks it", group: "check", runs: "host", glyph: "g-graph",
    summary: "A cheap model reads the ask and says whether it is clear enough to plan.",
    can: ["Read the ask and the project map", "Return clear / needs work with a reason"],
    cannot: ["Reject work outright — a turned-away ask still reaches you", "Edit the ask"],
    permissions: ["read-project", "spend-model-calls"],
    model: { uses: true, role: "routine" },
    inputs: [port("in", "Ask", ["idea", "request"], { required: true })],
    outputs: [port("clear", "Clear", ["request"]), port("unclear", "Needs work", ["rejected"])],
    settings: [
      { key: "strictness", type: "enum", label: "Strictness", options: ["light", "normal", "strict"], default: "normal",
        help: "How much an ask must say before it counts as plannable." },
    ],
    hostNote: "The work classifier already scores admissions with its own bar; the strictness here is not read yet.",
  },
  {
    type: "analyze.scope", label: "Analyse the ask", group: "plan", runs: "host", glyph: "g-analyzer",
    summary: "Decides whether this needs a plan at all, or is small enough to brief directly.",
    can: ["Read the project and the board", "Size the work", "Route it to planning or straight to a brief"],
    cannot: ["Write files", "Start a worker"],
    permissions: ["read-project", "spend-model-calls"],
    model: { uses: true, role: "routine" },
    inputs: [port("in", "Request", ["request"], { required: true })],
    outputs: [port("needs-plan", "Needs a plan", ["analysis"]), port("direct", "Small enough", ["brief"])],
    settings: [
      { key: "threshold", type: "enum", label: "Plan when", options: ["always", "multi-file", "never"], default: "multi-file",
        help: "Always plans everything; multi-file plans work that spans more than one file." },
    ],
    hostNote: "The work-shape classifier already sizes the work; the threshold here is not read yet.",
  },
  {
    type: "plan.build", label: "Make the plan", group: "plan", runs: "host", glyph: "g-plans",
    summary: "The planning service turns an analysed ask into steps, decisions and open questions.",
    can: ["Ask you the questions it cannot settle", "Write a plan you can review", "Fold an approved plan into tasks"],
    cannot: ["Build anything", "Approve its own plan"],
    permissions: ["read-project", "spend-model-calls", "create-task"],
    model: { uses: true, role: "heavy" },
    inputs: [port("in", "Analysis", ["analysis", "request"], { required: true })],
    outputs: [port("plan", "Plan", ["plan"]), port("questions", "Questions", ["ask"])],
    settings: [
      { key: "questions", type: "number", label: "Questions it may ask", default: 3, min: 0, max: 8,
        help: "How many open questions one planning pass may raise." },
      { key: "detail", type: "enum", label: "Plan detail", options: ["outline", "normal", "spec"], default: "normal",
        help: "How far the plan goes before it stops being a plan and becomes the work." },
    ],
    hostNote: "createPlanningService already runs this; the Plans sheet is its surface.",
  },
  {
    type: "brief.write", label: "Write the brief", group: "plan", runs: "host", glyph: "g-booklet",
    summary: "The scoped instruction one worker is handed: what to change, what not to touch, how it proves it.",
    can: ["Read the plan, the task record and the project", "Write the brief onto the task"],
    cannot: ["Change the plan", "Dispatch the work"],
    permissions: ["read-project", "spend-model-calls"],
    model: { uses: true, role: "heavy" },
    inputs: [port("in", "Plan", ["plan", "request"], { required: true })],
    outputs: [port("brief", "Brief", ["brief"])],
    settings: [
      { key: "evidence", type: "boolean", label: "Demand evidence", default: true,
        help: "The brief names the check the worker must run before it may report done." },
      { key: "budgetMinutes", type: "number", label: "Budget in minutes", default: 15, min: 5, max: 25,
        help: "What the worker is told it has. The hard kill stays at 25 minutes." },
    ],
    gate: "briefing",
    hostNote: "Present, ticks may spend a call on briefs (assistant proactive). Removed, they never do.",
  },
  {
    type: "assistant.review", label: "Assistant reviews it", group: "assistant", runs: "host", glyph: "g-command",
    summary: "The assistant reads the brief, notes what is wrong with it, and either accepts it or sends it back.",
    can: ["Read the brief, the board and recent history", "Write review notes", "Send the brief back as an issue"],
    cannot: ["Edit project files", "Start a worker", "Overrule your approval"],
    permissions: ["read-project", "spend-model-calls", "message-user"],
    model: { uses: true, role: "heavy" },
    inputs: [port("in", "Brief", ["brief"], { required: true })],
    outputs: [port("accepted", "Accepted", ["brief"]), port("issues", "Issues", ["issue"])],
    settings: [
      { key: "strictness", type: "enum", label: "Strictness", options: ["light", "normal", "strict"], default: "normal",
        help: "Strict sends a brief back for anything unproven; light only for contradictions." },
      { key: "notes", type: "boolean", label: "Keep the notes", default: true,
        help: "Review notes are written onto the task so the next worker reads them." },
    ],
    hostNote: "The overseer review already runs on finished work, with its own strictness; these dials are not read yet.",
  },
  {
    type: "assistant.setup", label: "Set up for Jev", group: "assistant", runs: "host", glyph: "g-sliders",
    summary: "Builds the question Jev is asked: the shortlist of candidates and the evidence behind each.",
    can: ["Read the model catalog and the local performance ledger", "Shortlist compatible candidates"],
    cannot: ["Choose the model", "Call a paid model"],
    permissions: ["read-project"],
    model: null,
    inputs: [port("in", "Brief", ["brief"], { required: true })],
    outputs: [port("question", "Jev question", ["jev-request"])],
    settings: [
      { key: "candidates", type: "number", label: "Candidates", default: 16, min: 2, max: 16,
        help: "How many models are put in front of Jev." },
      { key: "requireTools", type: "boolean", label: "Tool-callers only", default: true,
        help: "Build work only shortlists models that can call tools." },
    ],
    hostNote: "buildRoutingCandidates already does this with its own shortlist; these settings are not read yet.",
  },
  {
    type: "jev.classify", label: "Jev", group: "routing", runs: "host", glyph: "g-orbit",
    summary: "The classifier. It reads the candidates and reports values back — never runs work, never spends your build budget.",
    can: ["Read the question it is handed", "Answer with one candidate and its reasoning"],
    cannot: ["Run tasks", "Change settings", "See your keys"],
    permissions: ["network", "spend-model-calls"],
    model: { uses: true, role: "judge" },
    inputs: [port("in", "Jev question", ["jev-request"], { required: true })],
    outputs: [port("values", "Values", ["values"])],
    settings: [
      { key: "timeoutMs", type: "number", label: "Timeout (ms)", default: 4000, min: 500, max: 10000,
        help: "Past this, routing falls back to your usual model rather than waiting." },
    ],
    gate: "jev",
    hostNote: "Present, Jev routing is on (settings.jevShadow). Removed, the saved default model is used.",
  },
  {
    type: "model.pick", label: "Pick the model", group: "routing", runs: "host", glyph: "g-graph",
    summary: "The assistant takes Jev's values and settles which model this work is dispatched on.",
    can: ["Compare the values against your saved defaults", "Fall back to the default when evidence is thin"],
    cannot: ["Pick a model outside the provider you connected", "Ignore an explicit override you set"],
    permissions: [],
    model: null,
    // Values are not required: a map that drops Jev still has to be able to
    // pick a model — that is what "fixed" means.
    inputs: [port("values", "Values", ["values"]), port("brief", "Brief", ["brief"])],
    outputs: [port("route", "Route", ["route"])],
    settings: [
      { key: "mode", type: "enum", label: "Selection", options: ["auto", "fixed"], default: "auto", wired: true,
        help: "Auto compares candidates per task; Fixed always uses your saved defaults." },
    ],
    gate: "modelChoice",
    hostNote: "Writes settings.modelSelection on activate; applyModelRouting reads it on every call.",
  },
  {
    type: "work.dispatch", label: "Hand it to a worker", group: "build", runs: "host", glyph: "g-tasks",
    summary: "Claims the task, stamps a lease and starts a headless CLI agent on it.",
    can: ["Claim ready work", "Start a worker with the brief", "Stop a run that overruns its budget"],
    cannot: ["Work on a card another agent holds", "Mark its own run verified"],
    permissions: ["read-project", "write-files", "run-commands", "spawn-worker"],
    model: null,
    inputs: [port("route", "Route", ["route"], { required: true }), port("brief", "Brief", ["brief"])],
    outputs: [port("run", "Run", ["run"]), port("issues", "Issues", ["issue"])],
    settings: [
      // The build worker limit (autopilot.parallel), not the assistant's
      // roster: going live sets it, bounded by the studio's own cap.
      { key: "parallel", type: "number", label: "Workers at once", default: MAX_PARALLEL, min: 1, max: MAX_PARALLEL, wired: true,
        help: `How many builds may run together. The studio never runs more than ${MAX_PARALLEL}.` },
      { key: "maxFailures", type: "number", label: "Tries before parking", default: 5, min: 1, max: 5,
        help: "After this many failed runs a task waits for you instead of retrying." },
    ],
    gate: "dispatch",
    hostNote: "Present, ready work is dispatched (autopilot.execute) with Workers at once as the build worker limit. Removed, the board fills but nothing starts.",
  },
  {
    type: "verify.evidence", label: "Verify the evidence", group: "build", runs: "host", glyph: "g-eyes",
    summary: "Reported success is not done: changed files and executed checks inside the attempt's window decide it.",
    can: ["Read session changes and check results", "Reopen work that proved nothing", "Park work that keeps failing"],
    cannot: ["Take the worker's word for it", "Verify edits it cannot attribute"],
    permissions: ["read-project", "run-commands", "close-task"],
    model: { uses: true, role: "heavy" },
    inputs: [port("run", "Run", ["run"], { required: true })],
    outputs: [port("verdict", "Verdict", ["verdict"]), port("issues", "Issues", ["issue"])],
    settings: [
      { key: "attempts", type: "number", label: "Verify attempts", default: 3, min: 1, max: 5,
        help: "How many times a card may come back unverified before it parks." },
      { key: "dwellMs", type: "number", label: "Evidence dwell (ms)", default: 30000, min: 5000, max: 120000,
        help: "How long evidence is allowed to land before the card is judged." },
    ],
    hostNote: "autopilotHousekeeping and verifyCompletion already do this with the studio's own limits; these dials are not read yet.",
  },
  {
    type: "issue.intake", label: "Agent issues", group: "decide", runs: "map", glyph: "g-explorer",
    summary: "Where an agent's own problems enter: the MEFI_ASK line a worker prints, and runs that stopped.",
    can: ["Read what the agent printed and the task it belongs to", "Carry the evidence with the issue"],
    cannot: ["Answer anything", "Let an agent end its job by asking"],
    permissions: ["read-project"],
    model: null,
    inputs: [port("run", "Run", ["run", "any"])],
    outputs: [port("issue", "Issue", ["issue"])],
    settings: [
      { key: "perRun", type: "number", label: "Issues per run", default: 3, min: 1, max: 3, wired: true,
        help: "Caps how many decisions one run may raise." },
      { key: "fromFailures", type: "boolean", label: "Include stopped runs", default: true, wired: true,
        help: "A run that ends without the done line becomes an issue with its last output." },
    ],
    hostNote: "Live: the host reads both settings when a run prints an issue or ends without the verdict.",
  },
  {
    type: "issue.triage", label: "Triage", group: "decide", runs: "map", glyph: "g-sliders",
    summary: "Decides what the assistant settles by itself and what reaches you as a card.",
    can: ["Answer retryable issues within the attempt budget", "Escalate anything else"],
    cannot: ["Grant reach on your behalf", "Accept a risk on your behalf"],
    permissions: ["message-user"],
    model: null,
    inputs: [port("issue", "Issue", ["issue"], { required: true })],
    outputs: [port("ask", "Escalate", ["ask"]), port("answered", "Settled", ["answer"])],
    settings: [
      { key: "auto", type: "kinds", label: "Settle by itself", default: ["blocked", "check-failed", "verify", "run-failed"], wired: true,
        help: "Kinds the assistant may answer without you. Permission and risk can never be added — they are always yours." },
      { key: "autoRetryLimit", type: "number", label: "Auto retries", default: 2, min: 0, max: 5, wired: true,
        help: "After this many automatic retries on one task, the next one asks you instead." },
      { key: "repeatAsks", type: "enum", label: "Repeat questions", options: ["fold", "ask"], default: "fold", wired: true,
        help: "Fold: a question already asked on another card in the last day is not asked again — the earlier answer is recorded on the new card. Ask: every card asks." },
    ],
    hostNote: "Live: triageIssue reads this node on every issue, and a repeat question folds by its setting.",
  },
  {
    type: "ask.user", label: "Ask you", group: "decide", runs: "map", glyph: "g-help",
    summary: "The card in Ask: the task, what the agent saw, and options that act on the work.",
    can: ["Open a decision card", "Carry the evidence and a recommended option", "Write your answer onto the task"],
    cannot: ["Act before you answer", "Answer itself when it expires"],
    permissions: ["message-user"],
    model: null,
    inputs: [port("ask", "Ask", ["ask"], { required: true })],
    outputs: [port("answer", "Answer", ["answer"])],
    settings: [
      { key: "maxOpenAsks", type: "number", label: "Open cards at once", default: 6, min: 1, max: 20,
        help: "Past this, new decisions queue behind the ones already waiting." },
      { key: "expireHours", type: "number", label: "Expire after (hours)", default: 48, min: 1, max: 168, wired: true,
        help: "A decision nobody made is history, not a prompt." },
    ],
    hostNote: "Live: without this part no card opens, and a card expires after its hours. Open cards at once is not enforced yet.",
  },
  {
    type: "answer.apply", label: "Apply the answer", group: "decide", runs: "map", glyph: "g-tasks",
    summary: "Writes the decision onto the task and re-arms the work the way you chose.",
    can: ["Log the decision on the task", "Retry, re-plan, narrow, split or hold the work", "Record a grant for that task only"],
    cannot: ["Change anything you did not choose", "Apply an answer twice"],
    permissions: ["create-task", "close-task", "message-user"],
    model: null,
    inputs: [port("answer", "Answer", ["answer"], { required: true })],
    outputs: [port("request", "Re-armed work", ["request"])],
    settings: [
      { key: "announce", type: "boolean", label: "Say what changed", default: true, wired: true,
        help: "The assistant replies in the thread with what your answer did." },
      { key: "splitDepth", type: "number", label: "Follow-ups per chain", default: 3, min: 0, max: 5, wired: true,
        help: "How deep Split may go: a follow-up split from a follow-up is one deeper. 0 turns Split off." },
    ],
    hostNote: "Live: the issue action behind every Ask option. Split is not offered on a card at the follow-up limit.",
  },
  {
    type: "brain.call", label: "Another brain", group: "control", runs: "map", glyph: "g-orbit",
    summary: "Hands whatever reaches it to another map, and passes that map's result on.",
    can: ["Run another saved map's decision rules", "Nest up to four maps deep"],
    cannot: ["Call itself, directly or in a ring", "Widen what the calling map granted"],
    permissions: [],
    model: null,
    inputs: [port("in", "In", ["any"], { required: true })],
    outputs: [port("out", "Out", ["any"])],
    settings: [
      { key: "map", type: "map", label: "Map to call", default: "", wired: true,
        help: "Which saved brain map handles this branch." },
    ],
    hostNote: "Live when Agent issues feeds it: the inner map's triage, ask and apply parts decide those issues. Anything else inside it is drawn only.",
  },
  {
    type: "route.switch", label: "Branch", group: "control", runs: "map", glyph: "g-plane",
    summary: "Sends what arrives down one of two wires, on a field it reads.",
    can: ["Read one field of what passes through", "Send it one way or the other"],
    cannot: ["Change what passes through it"],
    permissions: [],
    model: null,
    inputs: [port("in", "In", ["any"], { required: true })],
    outputs: [port("yes", "Matches", ["any"]), port("no", "Otherwise", ["any"])],
    settings: [
      { key: "field", type: "text", label: "Field", default: "severity", help: "The field read from what arrives." },
      { key: "equals", type: "text", label: "Matches", default: "blocker", help: "Sent down Matches when the field equals this." },
    ],
    hostNote: "Drawn and validated. Nothing routes through it yet, so its field and match are not read.",
  },
  {
    type: "note", label: "Note", group: "control", runs: "draft", glyph: "g-booklet",
    summary: "A note on the canvas. Nothing reads it but you.",
    can: ["Hold a sentence next to the nodes it explains"],
    cannot: ["Do anything at all"],
    permissions: [],
    model: null,
    inputs: [],
    outputs: [],
    settings: [{ key: "text", type: "text", label: "Text", default: "", help: "What this corner of the map is for." }],
    hostNote: "Never executed.",
  },
];

const TYPE_INDEX = new Map(NODE_TYPES.map((type) => [type.type, type]));
const nodeType = (type) => TYPE_INDEX.get(type) ?? null;

/** Everything the editor's parts panel and inspector need, as plain data. */
function catalog() {
  return {
    schema: SCHEMA,
    groups: GROUPS,
    permissions: PERMISSIONS,
    portKinds: PORT_KINDS,
    gates: GATES,
    issueKinds: issues.ISSUE_KIND_IDS.map((kind) => ({
      kind,
      label: issues.ISSUE_KINDS[kind].label,
      severity: issues.ISSUE_KINDS[kind].severity,
      alwaysAsk: issues.ALWAYS_ASK.has(kind),
      autoAnswerable: issues.AUTO_ANSWERABLE.has(kind),
    })),
    nodes: NODE_TYPES.map((type) => ({
      ...type,
      inputs: type.inputs.map((item) => ({ ...item })),
      outputs: type.outputs.map((item) => ({ ...item })),
      settings: (type.settings ?? []).map((item) => ({ ...item })),
    })),
    limits: { maxNodes: MAX_NODES, maxEdges: MAX_EDGES, maxMaps: MAX_MAPS, maxNest: MAX_NEST },
  };
}

// ---- maps --------------------------------------------------------------------

const defaults = (type) => Object.fromEntries((type.settings ?? []).map((setting) => [setting.key,
  Array.isArray(setting.default) ? [...setting.default] : setting.default]));

function makeNode(type, { id, x = 0, y = 0, title = null, config = null, model = null } = {}) {
  const spec = nodeType(type);
  if (!spec) return null;
  return {
    id: id ?? `n_${type.replace(/[^a-z0-9]+/gi, "_")}`,
    type,
    title: clean(title, 60) || spec.label,
    x: coord(x),
    y: coord(y),
    config: { ...defaults(spec), ...(config && typeof config === "object" ? config : {}) },
    model: spec.model ? { mode: "inherit", role: spec.model.role, model: null, ...(model ?? {}) } : null,
  };
}

/**
 * The pipeline as it runs today, drawn out: an idea or an ask is checked,
 * analysed, planned, briefed, reviewed, set up for Jev, routed to a model,
 * built and verified — with the decision lane hanging off the build.
 */
function defaultMap({ id = "pipeline", name = "The studio pipeline" } = {}) {
  const at = (type, x, y, config) => makeNode(type, { id: `n_${type.replace(/\./g, "_")}`, x, y, config });
  const nodes = [
    at("idea.planner", 40, 40),
    at("user.request", 40, 200),
    at("inbox.request", 40, 360),
    at("check.user", 300, 120),
    at("check.model", 300, 300),
    at("analyze.scope", 560, 200),
    at("plan.build", 820, 140),
    at("brief.write", 1080, 200),
    at("assistant.review", 1340, 200),
    at("assistant.setup", 1600, 140),
    at("jev.classify", 1860, 140),
    at("model.pick", 2120, 200),
    at("work.dispatch", 2380, 200),
    at("verify.evidence", 2640, 200),
    at("issue.intake", 2380, 460),
    at("issue.triage", 2640, 460),
    at("ask.user", 2900, 400),
    at("answer.apply", 2900, 560),
  ].filter(Boolean);
  const wire = (from, fromPort, to, toPort, extra = {}) => ({
    id: `e_${from}_${fromPort}_${to}_${toPort}`.replace(/\./g, "_"),
    from: { node: `n_${from.replace(/\./g, "_")}`, port: fromPort },
    to: { node: `n_${to.replace(/\./g, "_")}`, port: toPort },
    ...extra,
  });
  const edges = [
    wire("idea.planner", "idea", "check.user", "in"),
    wire("user.request", "request", "check.model", "in"),
    wire("inbox.request", "request", "check.model", "in"),
    wire("check.user", "approved", "analyze.scope", "in"),
    wire("check.model", "clear", "analyze.scope", "in"),
    wire("analyze.scope", "needs-plan", "plan.build", "in"),
    wire("analyze.scope", "direct", "assistant.review", "in"),
    wire("plan.build", "plan", "brief.write", "in"),
    wire("brief.write", "brief", "assistant.review", "in"),
    wire("assistant.review", "accepted", "assistant.setup", "in"),
    wire("assistant.setup", "question", "jev.classify", "in"),
    wire("jev.classify", "values", "model.pick", "values"),
    wire("assistant.review", "accepted", "model.pick", "brief"),
    wire("model.pick", "route", "work.dispatch", "route"),
    wire("work.dispatch", "run", "verify.evidence", "run"),
    wire("work.dispatch", "issues", "issue.intake", "run"),
    wire("verify.evidence", "issues", "issue.intake", "run"),
    wire("assistant.review", "issues", "issue.triage", "issue"),
    wire("issue.intake", "issue", "issue.triage", "issue"),
    wire("issue.triage", "ask", "ask.user", "ask"),
    wire("issue.triage", "answered", "answer.apply", "answer"),
    wire("ask.user", "answer", "answer.apply", "answer"),
    // The decision loops back onto the work it was about. Marked as feedback
    // so the compiler keeps a runnable order instead of calling it a cycle.
    wire("answer.apply", "request", "check.model", "in", { feedback: true }),
  ];
  return normalizeMap({
    id, name, schema: SCHEMA, builtIn: true,
    description: "How work moves from an idea to a verified change, and where a decision reaches you.",
    grants: requiredGrants({ nodes }),
    nodes, edges,
  });
}

/** Bound and complete any saved map. Unknown node types are kept as errors. */
function normalizeMap(raw = {}) {
  const nodes = [];
  const seen = new Set();
  for (const item of Array.isArray(raw.nodes) ? raw.nodes : []) {
    if (nodes.length >= MAX_NODES) break;
    const type = clean(item?.type, 60);
    const id = clean(item?.id, 64);
    if (!ID_RE.test(id) || seen.has(id)) continue;
    seen.add(id);
    const spec = nodeType(type);
    const config = {};
    if (spec) {
      for (const setting of spec.settings ?? []) {
        const value = item?.config?.[setting.key];
        config[setting.key] = normalizeSetting(setting, value);
      }
    }
    nodes.push({
      id,
      type,
      title: clean(item?.title, 60) || spec?.label || type,
      x: coord(item?.x),
      y: coord(item?.y),
      config,
      model: spec?.model ? normalizeModel(item?.model, spec.model.role) : null,
    });
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const edges = [];
  const edgeKeys = new Set();
  const edgeIds = new Set();
  for (const item of Array.isArray(raw.edges) ? raw.edges : []) {
    if (edges.length >= MAX_EDGES) break;
    const from = { node: clean(item?.from?.node, 64), port: clean(item?.from?.port, 40) };
    const to = { node: clean(item?.to?.node, 64), port: clean(item?.to?.port, 40) };
    if (!from.node || !from.port || !to.node || !to.port) continue;
    const key = `${from.node}:${from.port}>${to.node}:${to.port}`;
    if (edgeKeys.has(key)) continue;
    edgeKeys.add(key);
    // A missing or repeated id takes the next free e_N: selection, problems
    // and the feedback list all name a wire by its id, so two may not share one.
    let id = ID_RE.test(clean(item?.id, 64)) ? clean(item.id, 64) : "";
    if (!id || edgeIds.has(id)) {
      let next = edges.length + 1;
      while (edgeIds.has(`e_${next}`)) next += 1;
      id = `e_${next}`;
    }
    edgeIds.add(id);
    edges.push({
      id,
      from, to,
      ...(item?.feedback === true ? { feedback: true } : {}),
    });
  }
  const grants = [...new Set((Array.isArray(raw.grants) ? raw.grants : []).filter((key) => PERMISSION_KEYS.includes(key)))];
  return {
    schema: SCHEMA,
    id: ID_RE.test(clean(raw.id, 64)) ? clean(raw.id, 64) : `map_${Math.abs(hash(JSON.stringify(nodes.map((node) => node.id))))}`,
    name: clean(raw.name, 80) || "Untitled brain",
    description: clean(raw.description, 240) || null,
    builtIn: raw.builtIn === true,
    active: raw.active === true,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : null,
    grants,
    nodes,
    edges: edges.filter((edge) => nodeIds.has(edge.from.node) && nodeIds.has(edge.to.node)),
  };
}

function hash(text) {
  let value = 0;
  for (let index = 0; index < text.length; index += 1) value = (value * 31 + text.charCodeAt(index)) | 0;
  return value;
}

function normalizeSetting(setting, value) {
  if (setting.type === "boolean") return typeof value === "boolean" ? value : setting.default;
  if (setting.type === "number") {
    // Blank is "not set", not zero: a cleared Follow-ups field must not turn
    // Split off by accident.
    const number = value === null || value === "" ? NaN : Number(value);
    if (!Number.isFinite(number)) return setting.default;
    return Math.max(setting.min ?? 0, Math.min(setting.max ?? 1e6, Math.round(number)));
  }
  if (setting.type === "enum") return setting.options.includes(value) ? value : setting.default;
  if (setting.type === "kinds") {
    // Only a kind the assistant has an answer for can be settled by it. That
    // keeps a grant or a risk from being automated back into silence, and any
    // kind without a safe automatic answer — a new one included — stays yours.
    const list = (Array.isArray(value) ? value : setting.default)
      .filter((kind) => issues.AUTO_ANSWERABLE.has(kind) && !issues.ALWAYS_ASK.has(kind));
    return [...new Set(list)];
  }
  if (setting.type === "map") return clean(value, 64);
  return clean(value, 400);
}

function normalizeModel(raw, fallbackRole) {
  const mode = ["inherit", "role", "pinned"].includes(raw?.mode) ? raw.mode : "inherit";
  const role = ["routine", "heavy", "judge", "worker"].includes(raw?.role) ? raw.role : fallbackRole;
  const model = clean(raw?.model, 160) || null;
  return { mode, role, model: mode === "pinned" ? model : null };
}

/** Every permission the nodes in a map need, as the grant list it must carry. */
function requiredGrants({ nodes = [] } = {}) {
  const grants = new Set();
  for (const node of nodes) for (const key of nodeType(node?.type)?.permissions ?? []) grants.add(key);
  return [...grants];
}

// ---- validation ---------------------------------------------------------------

const problem = (level, code, text, extra = {}) => ({ level, code, text, ...extra });

/**
 * Everything wrong with a map, in the order it matters. Errors block
 * activation; warnings are drawn on the canvas and left to you.
 */
function validateMap(map, { maps = [], depth = 0 } = {}) {
  const graph = normalizeMap(map);
  const problems = [];
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  if (!graph.nodes.length) problems.push(problem("error", "empty", "This map has no nodes yet."));
  for (const node of graph.nodes) {
    const spec = nodeType(node.type);
    if (!spec) {
      problems.push(problem("error", "unknown-type", `"${node.title}" is a ${node.type} node, which this build does not have.`, { nodeId: node.id, fix: "Delete it, or open this map in the build that made it." }));
      continue;
    }
    for (const key of spec.permissions) {
      if (!graph.grants.includes(key)) {
        const permission = PERMISSIONS.find((item) => item.key === key);
        problems.push(problem("error", "ungranted", `"${node.title}" needs ${permission?.label ?? key}, which this map does not grant.`, { nodeId: node.id, permission: key, fix: `Grant ${permission?.label ?? key} on the map, or remove the node.` }));
      }
    }
    for (const input of spec.inputs) {
      if (!input.required) continue;
      const wired = graph.edges.some((edge) => edge.to.node === node.id && edge.to.port === input.id);
      if (!wired) problems.push(problem("error", "missing-input", `"${node.title}" has nothing wired into ${input.label}.`, { nodeId: node.id, port: input.id, fix: `Wire something into ${input.label}.` }));
    }
    if (spec.outputs.length && !graph.edges.some((edge) => edge.from.node === node.id)) {
      problems.push(problem("warn", "dead-end", `"${node.title}" produces something nothing reads.`, { nodeId: node.id, fix: "Wire an output, or leave it as a spare." }));
    }
    if (node.type === "brain.call") {
      const target = clean(node.config?.map, 64);
      if (!target) problems.push(problem("error", "no-map", `"${node.title}" does not say which brain to call.`, { nodeId: node.id, fix: "Pick a map in the inspector." }));
      else if (target === graph.id) problems.push(problem("error", "self-call", `"${node.title}" calls the map it is in.`, { nodeId: node.id, fix: "Point it at a different map." }));
      else {
        const inner = maps.find((item) => item?.id === target);
        if (!inner) problems.push(problem("error", "missing-map", `"${node.title}" calls a map that is not saved here.`, { nodeId: node.id, fix: "Pick a saved map." }));
        else if (depth >= MAX_NEST) problems.push(problem("error", "too-deep", `"${node.title}" nests brains more than ${MAX_NEST} deep.`, { nodeId: node.id, fix: "Flatten one of the inner maps." }));
        else if (callsBack(inner, graph.id, maps, depth + 1)) problems.push(problem("error", "recursive", `"${node.title}" calls a map that calls this one back.`, { nodeId: node.id, fix: "Break the ring." }));
      }
    }
  }
  for (const edge of graph.edges) {
    const from = byId.get(edge.from.node);
    const to = byId.get(edge.to.node);
    const fromSpec = nodeType(from?.type);
    const toSpec = nodeType(to?.type);
    const output = fromSpec?.outputs.find((item) => item.id === edge.from.port);
    const input = toSpec?.inputs.find((item) => item.id === edge.to.port);
    if (!output) { problems.push(problem("error", "bad-port", `A wire leaves a port "${from?.title ?? edge.from.node}" does not have.`, { edgeId: edge.id, fix: "Delete the wire." })); continue; }
    if (!input) { problems.push(problem("error", "bad-port", `A wire arrives at a port "${to?.title ?? edge.to.node}" does not have.`, { edgeId: edge.id, fix: "Delete the wire." })); continue; }
    if (!compatible(output.kinds, input.kinds)) {
      problems.push(problem("error", "type-mismatch", `"${from.title}" sends ${output.kinds.join("/")} into ${input.label}, which takes ${input.kinds.join("/")}.`, { edgeId: edge.id, fix: "Wire it somewhere that accepts it." }));
    }
    if (edge.from.node === edge.to.node) problems.push(problem("error", "self-wire", `"${from.title}" is wired to itself.`, { edgeId: edge.id, fix: "Delete the wire." }));
  }
  for (const cycle of findCycles(graph)) {
    problems.push(problem("warn", "feedback", `${cycle.map((id) => `"${byId.get(id)?.title ?? id}"`).join(" → ")} loops back. It runs as feedback, after the pass that fed it.`, { nodeId: cycle[0], fix: "Mark the closing wire as feedback, or break the loop." }));
  }
  const reachable = reachableFrom(graph);
  for (const node of graph.nodes) {
    const spec = nodeType(node.type);
    if (!spec || spec.group === "control" || !spec.inputs.length) continue;
    if (!reachable.has(node.id)) problems.push(problem("warn", "unreachable", `Nothing reaches "${node.title}".`, { nodeId: node.id, fix: "Wire it to the pipeline, or delete it." }));
  }
  for (const spec of NODE_TYPES.filter((item) => item.singleton)) {
    const count = graph.nodes.filter((node) => node.type === spec.type).length;
    if (count > 1) problems.push(problem("error", "duplicate", `A map may only have one "${spec.label}".`, { fix: `Delete the extra ${spec.label} nodes.` }));
  }
  // A map that starts workers needs somewhere for their questions to go.
  // Without triage and an Ask part the host only logs an issue, and a
  // permission or a risk is a question only the owner may answer.
  const dispatch = graph.nodes.find((node) => node.type === "work.dispatch");
  if (dispatch) {
    const lane = issuePolicyFor(graph, { maps });
    if (!lane.triage || !lane.asks) {
      const missing = !lane.triage && !lane.asks ? "Triage or Ask you part" : !lane.triage ? "Triage part" : "Ask you part";
      problems.push(problem("warn", "no-decision-lane", `"${dispatch.title}" starts workers, but this map has no ${missing} for their questions — on the map or in a brain Agent issues feeds. Permission and risk questions would only be logged and would never reach you.`, { nodeId: dispatch.id, fix: "Wire Agent issues → Triage → Ask you, or into another brain that holds them." }));
    }
  }
  return {
    ok: !problems.some((item) => item.level === "error"),
    problems,
    errors: problems.filter((item) => item.level === "error").length,
    warnings: problems.filter((item) => item.level === "warn").length,
  };
}

const compatible = (outputs, inputs) => outputs.includes("any") || inputs.includes("any")
  || outputs.some((kind) => inputs.includes(kind));

function callsBack(map, targetId, maps, depth) {
  if (depth > MAX_NEST) return false;
  const graph = normalizeMap(map);
  for (const node of graph.nodes) {
    if (node.type !== "brain.call") continue;
    const next = clean(node.config?.map, 64);
    if (!next) continue;
    if (next === targetId) return true;
    const inner = maps.find((item) => item?.id === next);
    if (inner && callsBack(inner, targetId, maps, depth + 1)) return true;
  }
  return false;
}

function reachableFrom(graph) {
  const roots = graph.nodes.filter((node) => !(nodeType(node.type)?.inputs.length));
  const seen = new Set(roots.map((node) => node.id));
  const queue = [...seen];
  while (queue.length) {
    const id = queue.shift();
    for (const edge of graph.edges) {
      if (edge.from.node !== id || seen.has(edge.to.node)) continue;
      seen.add(edge.to.node);
      queue.push(edge.to.node);
    }
  }
  return seen;
}

/** Cycles that are not already declared as feedback, shortest first. */
function findCycles(graph) {
  const out = new Map();
  for (const edge of graph.edges) {
    if (edge.feedback) continue;
    if (!out.has(edge.from.node)) out.set(edge.from.node, []);
    out.get(edge.from.node).push(edge.to.node);
  }
  const cycles = [];
  const colour = new Map();
  const stack = [];
  const walk = (id) => {
    colour.set(id, 1);
    stack.push(id);
    for (const next of out.get(id) ?? []) {
      if (colour.get(next) === 1) {
        const from = stack.indexOf(next);
        if (from >= 0) {
          const ring = stack.slice(from);
          const key = [...ring].sort().join(">");
          if (!cycles.some((item) => item.key === key)) cycles.push({ key, ring });
        }
      } else if (!colour.has(next)) walk(next);
    }
    stack.pop();
    colour.set(id, 2);
  };
  for (const node of graph.nodes) if (!colour.has(node.id)) walk(node.id);
  return cycles.map((item) => item.ring);
}

/**
 * The wires a depth-first walk meets pointing back at a part still on its
 * path: each closes a ring, and taking just those out leaves an order.
 * Declared feedback wires are already out.
 */
function closingEdges(graph) {
  const out = new Map();
  for (const edge of graph.edges) {
    if (edge.feedback) continue;
    if (!out.has(edge.from.node)) out.set(edge.from.node, []);
    out.get(edge.from.node).push(edge);
  }
  const colour = new Map();
  const closing = new Set();
  const walk = (id) => {
    colour.set(id, 1);
    for (const edge of out.get(id) ?? []) {
      const seen = colour.get(edge.to.node);
      if (seen === 1) closing.add(edge.id);
      else if (!seen) walk(edge.to.node);
    }
    colour.set(id, 2);
  };
  for (const node of graph.nodes) if (!colour.has(node.id)) walk(node.id);
  return closing;
}

// ---- compiling ----------------------------------------------------------------

/**
 * The order the map runs in, the wires that close a loop, the switches it
 * moves, and the decision rules it hands the host.
 */
function compileMap(map, { maps = [] } = {}) {
  const graph = normalizeMap(map);
  const check = validateMap(graph, { maps });
  const incoming = new Map(graph.nodes.map((node) => [node.id, 0]));
  const out = new Map(graph.nodes.map((node) => [node.id, []]));
  const feedback = [];
  const closing = closingEdges(graph);
  for (const edge of graph.edges) {
    // The wire that closes a ring is scheduled as feedback: it carries a
    // result into the NEXT pass rather than making this one impossible to
    // order. Only that wire — the rest of the ring keeps its place in order.
    const loops = edge.feedback || closing.has(edge.id);
    if (loops) { feedback.push(edge); continue; }
    out.get(edge.from.node).push(edge.to.node);
    incoming.set(edge.to.node, (incoming.get(edge.to.node) ?? 0) + 1);
  }
  const ready = graph.nodes.filter((node) => !incoming.get(node.id)).map((node) => node.id);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const next of out.get(id) ?? []) {
      const left = (incoming.get(next) ?? 0) - 1;
      incoming.set(next, left);
      if (left === 0) ready.push(next);
    }
  }
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const stages = order.map((id) => {
    const node = byId.get(id);
    const spec = nodeType(node.type);
    return {
      nodeId: id,
      type: node.type,
      title: node.title,
      runs: spec?.runs ?? "draft",
      gate: spec?.gate ?? null,
      model: node.model,
      config: node.config,
      permissions: spec?.permissions ?? [],
      inputs: graph.edges.filter((edge) => edge.to.node === id).map((edge) => ({ from: edge.from.node, port: edge.to.port })),
      outputs: graph.edges.filter((edge) => edge.from.node === id).map((edge) => ({ to: edge.to.node, port: edge.from.port })),
    };
  });
  return {
    ok: check.ok && order.length === graph.nodes.length,
    mapId: graph.id,
    name: graph.name,
    order,
    stages,
    feedback: feedback.map((edge) => edge.id),
    unordered: graph.nodes.filter((node) => !order.includes(node.id)).map((node) => node.id),
    gates: gatesFor(graph),
    issuePolicy: issuePolicyFor(graph, { maps }),
    problems: check.problems,
  };
}

/**
 * The switches a map moves when it is activated. `null` means the map does not
 * speak to that switch, so activation leaves it exactly as it is.
 */
function gatesFor(map) {
  const graph = normalizeMap(map);
  const has = (type) => graph.nodes.find((node) => node.type === type) ?? null;
  const dispatch = has("work.dispatch");
  const pick = has("model.pick");
  return {
    approveBeforeBuild: has("check.user") ? true : graph.nodes.length ? false : null,
    briefing: has("brief.write") ? true : graph.nodes.length ? false : null,
    jev: has("jev.classify") ? true : graph.nodes.length ? false : null,
    modelChoice: pick ? (pick.config?.mode === "fixed" ? "fixed" : "auto") : null,
    dispatch: dispatch ? true : graph.nodes.length ? false : null,
    parallel: dispatch ? Number(dispatch.config?.parallel) || null : null,
  };
}

const DECISION_TYPES = ["issue.intake", "issue.triage", "ask.user", "answer.apply"];

// The "Another brain" parts an issue reaches from the given parts, nearest
// first. Feedback wires carry an answer into the next pass, not an issue
// onward, so they are not followed.
function callsDownstream(graph, entries) {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const seen = new Set(entries.map((node) => node.id));
  const queue = [...seen];
  const calls = [];
  while (queue.length) {
    const id = queue.shift();
    if (byId.get(id)?.type === "brain.call") calls.push(byId.get(id));
    for (const edge of graph.edges) {
      if (edge.feedback || edge.from.node !== id || seen.has(edge.to.node)) continue;
      seen.add(edge.to.node);
      queue.push(edge.to.node);
    }
  }
  return calls;
}

/**
 * The decision parts a map's issues actually meet: its own first, and for any
 * it lacks, the ones held in another brain that Agent issues feeds — the
 * nearest call first, as deep as nesting may go, each map visited once.
 */
function decisionParts(map, { maps = [] } = {}) {
  const found = Object.fromEntries(DECISION_TYPES.map((type) => [type, null]));
  const complete = () => DECISION_TYPES.every((type) => found[type]);
  const seen = new Set();
  const visit = (graph, depth, entries) => {
    seen.add(graph.id);
    for (const type of DECISION_TYPES) found[type] ??= graph.nodes.find((node) => node.type === type) ?? null;
    if (complete() || depth >= MAX_NEST) return;
    for (const call of callsDownstream(graph, entries)) {
      const target = maps.find((item) => item?.id === clean(call.config?.map, 64));
      if (!target) continue;
      const inner = normalizeMap(target);
      if (seen.has(inner.id)) continue;
      // Whatever reaches a called map is its input as a whole, unless the
      // map has its own Agent issues part to take it in.
      const intakes = inner.nodes.filter((node) => node.type === "issue.intake");
      visit(inner, depth + 1, intakes.length ? intakes : inner.nodes);
      if (complete()) return;
    }
  };
  const graph = normalizeMap(map);
  visit(graph, 0, graph.nodes.filter((node) => node.type === "issue.intake"));
  return found;
}

/**
 * The live decision rules: what the assistant settles, and what reaches you.
 * Pass the store's maps so a lane held in an "Another brain" part is found.
 */
function issuePolicyFor(map, { maps = [] } = {}) {
  const parts = decisionParts(map, { maps });
  const intake = parts["issue.intake"];
  const triage = parts["issue.triage"];
  const ask = parts["ask.user"];
  const apply = parts["answer.apply"];
  const splitDepth = Number(apply?.config?.splitDepth);
  return {
    ...issues.normalizePolicy({
      auto: triage?.config?.auto,
      autoRetryLimit: triage?.config?.autoRetryLimit,
      maxOpenAsks: ask?.config?.maxOpenAsks,
    }),
    // No triage node means nothing is settled automatically and no card is
    // opened either — an issue is only logged. That is a real choice, so it is
    // reported rather than quietly replaced with the defaults.
    triage: Boolean(triage),
    asks: Boolean(ask),
    perRun: Math.max(1, Math.min(issues.ISSUE_MAX_PER_RUN, Number(intake?.config?.perRun) || issues.ISSUE_MAX_PER_RUN)),
    fromFailures: intake ? intake.config?.fromFailures !== false : true,
    expireHours: Math.max(1, Math.min(168, Number(ask?.config?.expireHours) || 48)),
    // How deep Split may take a follow-up chain; 0 turns Split off.
    splitDepth: apply && Number.isInteger(splitDepth) ? Math.max(0, Math.min(5, splitDepth)) : 3,
    repeatAsks: triage?.config?.repeatAsks === "ask" ? "ask" : "fold",
    // Nothing is announced by a map with no apply part to say it.
    announce: apply ? apply.config?.announce !== false : false,
  };
}

// ---- live activity --------------------------------------------------------------
// What the decision lane, dispatch and verification actually did lately, per
// part type, so a map shows its traffic and not only its wiring. It is read
// from what the host already keeps — the Ask cards, the decisions written on
// tasks, the task log's verdict rows and the executor ledger — and `now` is
// passed in: nothing here reads the clock.

const ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;
// The host's own wording, so these follow main.cjs if it changes.
const SETTLED_TEXT = /^the assistant settled this\b/i;
const FOLDED_TEXT = /already answered on another card/i;
const VERDICT_TEXT = /^(un)?verified\s+—/i;

const tally = (counts, key) => { counts[key] = (counts[key] ?? 0) + 1; };
const ranked = (counts) => Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
// A release reason carries live numbers ("111 MB available"); the brackets
// are dropped so one cause counts as one reason.
const reasonKey = (text) => clean(String(text ?? "").replace(/\s*\([^)]*\)/g, ""), 120) || "no reason given";

/**
 * Counts per part type for the last `windowMs` before `now`: what Agent issues
 * raised, what Triage settled or asked, what Ask you opened and how it was
 * answered, what the answers did, and what dispatch and verification saw.
 * Each part carries a headline for its badge and the lines its inspector lists.
 * `expireHours` is the live map's Ask expiry, which dates an expired card.
 */
function partActivity({ questions = [], tasks = [], executorRows = [], now, windowMs = ACTIVITY_WINDOW_MS, expireHours = 48 } = {}) {
  const end = Number(now);
  const span = Number(windowMs) > 0 ? Number(windowMs) : ACTIVITY_WINDOW_MS;
  if (!Number.isFinite(end)) return { windowMs: span, since: null, parts: {} };
  const since = end - span;
  const recent = (at) => Number.isFinite(Number(at)) && Number(at) >= since && Number(at) <= end;
  // An expired card carries no answer time. It ran out expireHours after it
  // was asked, so it counts in the window that moment falls in, not the one
  // it was asked in (which, at 48 hours, a day's window never holds).
  const expireMs = (Number(expireHours) > 0 ? Number(expireHours) : 48) * 60 * 60 * 1000;
  const closedAt = (question, answer) => answer?.at
    || question.expiredAt
    || (question.status === "expired" && Number.isFinite(Number(question.at)) ? Math.min(end, Number(question.at) + expireMs) : question.at);

  const raised = {};
  let settled = 0;
  let folded = 0;
  const statuses = {};
  let asked = 0;
  let open = 0;
  let offered = 0;
  let taken = 0;
  const verbs = {};
  let notApplied = 0;
  for (const question of Array.isArray(questions) ? questions : []) {
    if (question?.source !== "issue") continue;
    // Open is how things stand now, whenever the card was opened.
    if (question.status === "open") open += 1;
    if (recent(question.at)) {
      asked += 1;
      tally(raised, question.context?.issueKind || "conflict");
    }
    const answer = question.answer && typeof question.answer === "object" ? question.answer : null;
    if (question.status === "open" || !recent(closedAt(question, answer))) continue;
    tally(statuses, question.status);
    if (!answer?.optionId) continue;
    const options = Array.isArray(question.options) ? question.options : [];
    const recommended = options.find((option) => option?.recommended);
    if (recommended) {
      offered += 1;
      if (recommended.id === answer.optionId) taken += 1;
    }
    const chosen = options.find((option) => option?.id === answer.optionId);
    tally(verbs, clean(chosen?.action?.action || answer.optionId, 40));
    if (answer.error) notApplied += 1;
  }

  let verified = 0;
  let unverified = 0;
  for (const task of Array.isArray(tasks) ? tasks : []) {
    for (const decision of Array.isArray(task?.decisions) ? task.decisions : []) {
      if (!recent(decision?.at)) continue;
      const text = String(decision.text ?? "");
      // An owner's answer arrives through its card and is counted there; a
      // decision only the assistant wrote is an issue no card ever showed.
      if (SETTLED_TEXT.test(text)) { settled += 1; tally(raised, decision.kind || "conflict"); }
      else if (FOLDED_TEXT.test(text)) { folded += 1; tally(raised, decision.kind || "conflict"); }
    }
    for (const row of Array.isArray(task?.logs) ? task.logs : []) {
      if (!recent(row?.at)) continue;
      const verdict = VERDICT_TEXT.exec(String(row.text ?? ""));
      if (verdict) { if (verdict[1]) unverified += 1; else verified += 1; }
    }
  }

  let starts = 0;
  let finishes = 0;
  let failed = 0;
  let releases = 0;
  const reasons = {};
  for (const row of Array.isArray(executorRows) ? executorRows : []) {
    if (!recent(row?.at)) continue;
    if (row.event === "start") starts += 1;
    else if (row.event === "finish") { finishes += 1; if (row.ok !== true) failed += 1; }
    else if (row.event === "release") { releases += 1; tally(reasons, reasonKey(row.reason)); }
  }

  const raisedTotal = Object.values(raised).reduce((sum, count) => sum + count, 0);
  const answered = statuses.answered ?? 0;
  const [topVerb, topVerbCount] = ranked(verbs)[0] ?? ["applied", 0];
  const [topReason, topReasonCount] = ranked(reasons)[0] ?? [null, 0];
  const part = (headline, lines, counts) => ({ headline: { label: headline[0], count: headline[1] }, lines, ...counts });
  return {
    windowMs: span,
    since,
    parts: {
      "issue.intake": part(["raised", raisedTotal],
        [`${raisedTotal} raised`, ...ranked(raised).map(([kind, count]) => `${count} ${kind}`)],
        { raised: raisedTotal, byKind: raised }),
      "issue.triage": part(["settled", settled],
        [`${settled} settled by the assistant`, `${asked} asked you`, `${folded} folded into an earlier answer`],
        { settled, asked, folded }),
      "ask.user": part(["asked", asked],
        [`${asked} asked`, `${open} open now`, `${answered} answered`, `${statuses.dismissed ?? 0} dismissed`, `${statuses.expired ?? 0} expired`,
          ...(statuses.superseded ? [`${statuses.superseded} superseded`] : []),
          `Recommended option taken ${taken} of ${offered}`],
        { asked, open, answered, dismissed: statuses.dismissed ?? 0, expired: statuses.expired ?? 0, superseded: statuses.superseded ?? 0,
          recommendedTaken: taken, recommendedOffered: offered }),
      "answer.apply": part([topVerb, topVerbCount],
        [...ranked(verbs).map(([verb, count]) => `${count} ${verb}`), `${notApplied} not applied`],
        { byVerb: verbs, notApplied }),
      "work.dispatch": part(["started", starts],
        [`${starts} started`, `${finishes} finished${failed ? ` (${failed} failed)` : ""}`,
          `${releases} released${topReason ? ` — most often: ${topReason} (${topReasonCount})` : ""}`],
        { starts, finishes, failed, releases, topRelease: topReason ? { reason: topReason, count: topReasonCount } : null }),
      "verify.evidence": part(["verified", verified],
        [`${verified} verified`, `${unverified} unverified`],
        { verified, unverified }),
    },
  };
}

/**
 * One line per map for the switcher and the palette. Pass the store's maps:
 * without them every configured "Another brain" part counts as a missing map.
 */
function summarize(map, { maps = [] } = {}) {
  const graph = normalizeMap(map);
  const check = validateMap(graph, { maps });
  const live = graph.nodes.filter((node) => nodeType(node.type)?.runs !== "draft").length;
  return {
    id: graph.id, name: graph.name, description: graph.description, builtIn: graph.builtIn, active: graph.active,
    updatedAt: graph.updatedAt, nodes: graph.nodes.length, edges: graph.edges.length, live,
    ok: check.ok, errors: check.errors, warnings: check.warnings,
  };
}

module.exports = {
  SCHEMA, MAX_NODES, MAX_EDGES, MAX_MAPS, MAX_NEST, MAX_PARALLEL, ACTIVITY_WINDOW_MS,
  PERMISSIONS, PERMISSION_KEYS, PORT_KINDS, PORT_KIND_IDS, GROUPS, GATES, NODE_TYPES,
  nodeType, catalog, makeNode, defaultMap, normalizeMap, requiredGrants,
  validateMap, compileMap, gatesFor, issuePolicyFor, partActivity, summarize,
};
