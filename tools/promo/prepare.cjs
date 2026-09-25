// Seeded fake-bridge copy of the current app UI for promotional footage.
// Generic "Notes app" sample data only; never a real project.
//
//   node tools/promo/prepare.cjs
// Writes only under the ignored dist/promo directory.
const fs = require("node:fs");
const path = require("node:path");
const ROOT = path.resolve(__dirname, "../..");
const HERE = path.join(ROOT, "dist/promo/work");
const IN = path.join(HERE, "input");
const OUT = path.join(HERE, "preview");
fs.mkdirSync(IN, { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
{
  const inputs = {
    "booklet.html": "renderer/booklet.html",
    "models.json": "data/models.json",
    "brains.cjs": "scripts/brains.cjs",
    "agent-issues.cjs": "scripts/agent-issues.cjs",
  };
  for (const [name, repoPath] of Object.entries(inputs)) {
    const bytes = fs.readFileSync(path.join(ROOT, repoPath));
    fs.writeFileSync(path.join(IN, name), bytes);
  }
  console.log("Inputs from the current renderer; only synthetic project data follows.");
}
const brains = require(path.join(IN, "brains.cjs"));
const catalog = JSON.parse(fs.readFileSync(path.join(IN, "models.json"), "utf8"));
const now = Date.now();
const M = 60000;
const H = 60 * M;
const P = "C:\\Projects\\notes-app";

const map = { ...brains.defaultMap(), active: true };
const maps = [map];

const goWindows = {
  rolling: { percent: 23, resetsAt: now + 3 * H },
  weekly: { percent: 41, resetsAt: now + 4 * 24 * H },
  monthly: { percent: 18, resetsAt: now + 19 * 24 * H },
};

const seed = {
  startupState: { ok: true, chosen: true, mode: "workspace", ready: true },
  prefsGet: { ok: true, prefs: { commandHome: false } },
  projectsList: { ok: true, activeId: "p1", projects: [
    { id: "p1", name: "Notes app", path: P },
    { id: "p2", name: "Recipe site", path: "C:\\Projects\\recipe-site" },
  ] },
  eyesState: { ok: true, sessions: [
    { id: "ses_1", title: "Add an empty state to the notes list", directory: P, timeCreated: now - 40 * M, timeUpdated: now - M },
    { id: "ses_2", title: "Search notes by tag", directory: P, timeCreated: now - 20 * M, timeUpdated: now - 2 * M },
    { id: "ses_3", title: "Export notes as Markdown", directory: P, timeCreated: now - 90 * M, timeUpdated: now - 12 * M },
  ], todos: [
    { id: "t1", sessionId: "ses_1", content: "Render the empty-state card", status: "completed" },
    { id: "t2", sessionId: "ses_1", content: "Add the Create note button", status: "in_progress" },
    { id: "t3", sessionId: "ses_1", content: "Check the smallest window size", status: "pending" },
    { id: "t4", sessionId: "ses_2", content: "Index tags on save", status: "in_progress" },
    { id: "t5", sessionId: "ses_2", content: "Filter chips above the list", status: "pending" },
    { id: "t6", sessionId: "ses_3", content: "Write the exporter", status: "completed" },
    { id: "t7", sessionId: "ses_3", content: "Add a menu entry", status: "completed" },
  ], changes: [], pngs: [] },
  tasksList: { ok: true, tasks: [
    { id: "task_a", title: "Add an empty state to the notes list", status: "open", stage: "working", createdAt: now - 30 * M, updatedAt: now - M },
    { id: "task_b", title: "Search notes by tag", status: "open", stage: "working", createdAt: now - 50 * M, updatedAt: now - 5 * M },
    { id: "task_c", title: "Export notes as Markdown", status: "done", stage: "awaiting_verification", createdAt: now - 80 * M, updatedAt: now - 3 * M },
    { id: "task_d", title: "Keyboard shortcut for new note", status: "open", stage: "ready", createdAt: now - 200 * M, updatedAt: now - 20 * M },
    { id: "task_e", title: "Dark mode for the editor", status: "open", stage: "ready", createdAt: now - 220 * M, updatedAt: now - 60 * M },
    { id: "task_f", title: "Pin favourite notes", status: "done", stage: "done", createdAt: now - 400 * M, updatedAt: now - 300 * M },
  ] },
  ideasList: { ok: true, ideas: [
    { id: "i1", title: "Sync notes between devices", status: "new", createdAt: now - 500 * M },
    { id: "i2", title: "Note templates", status: "new", createdAt: now - 600 * M },
  ] },
  eyesCheckpointsRead: { ok: true, checkpoints: {} },
  eyesRequestsRead: { ok: true, requests: [] },
  eyesBriefingRead: { ok: true, briefing: null },
  eyesCollisions: { ok: true, collisions: [], presence: [] },
  speedMeasurements: { ok: true, measurements: {} },
  assistantState: { ok: true, state: {
    status: "running", unread: 0, heartbeatAt: now - 20000, intervalMs: 60000, nextTickAt: now + 40000,
    ai: { keyPresent: true, online: true },
    agents: [
      { role: "thinker", status: "running", since: now - 70000, text: "weighing the next task" },
      { role: "builder", status: "running", since: now - 4 * M, text: "Add an empty state to the notes list · build 2/3" },
      { role: "builder", status: "running", since: now - 50000, text: "Search notes by tag · indexing tags" },
      { role: "auditor", status: "done", lastRunAt: now - 9 * M, text: "auditor done · 0 findings" },
      { role: "watcher", status: "done", lastRunAt: now - 3 * M, text: "watcher done · 3 sessions" },
      { role: "foreman", status: "done", lastRunAt: now - 2 * M, text: "foreman done · 2 ready" },
      { role: "briefer", status: "idle", lastRunAt: now - 60 * M, text: "" },
    ],
    messages: [
      { role: "user", text: "What should the notes list show when it is empty?", at: now - 14 * M },
      { role: "assistant", text: "A short line saying there are no notes yet and a Create note button. I can make that a task with the acceptance checks written out.", at: now - 14 * M + 4000, via: "local" },
      { role: "user", text: "Yes, give it as a task.", at: now - 13 * M },
      { role: "assistant", text: "Created \"Add an empty state to the notes list\". A builder picked it up; follow it under Your work or in Command view.", at: now - 13 * M + 3000 },
      { role: "assistant", text: "Builder reported: finished \"Export notes as Markdown\". It is waiting for verification in Review.", at: now - 3 * M },
    ],
    thinking: { text: "Reading the notes list component" },
    work: [], prefs: {}, log: [],
    questions: [
      { id: "q1", kind: "question", status: "open", at: now - 3 * M, title: "Should the empty state also appear when a search has no matches?",
        detail: "The list is empty in two situations: no notes at all, and a filter that matches nothing.",
        options: [
          { id: "a", label: "Yes, one component for both", description: "Simpler, with a different line of text", recommended: true },
          { id: "b", label: "No, only with zero notes", description: "Keep the search case as it is" },
        ] },
    ],
  } },
  assistantStatus: { ok: true, status: {
    enabled: true, execute: true, mode: "swarm", parallel: 2, adaptiveParallel: true, autoBuild: true, minutes: 5, lastPassAt: now - 2 * M,
    running: [
      { taskId: "task_a", title: "Add an empty state to the notes list", startedAt: now - 4 * M, phase: "building", progress: 0.6 },
      { taskId: "task_b", title: "Search notes by tag", startedAt: now - 50000, phase: "building", progress: 0.3 },
    ], history: [],
  } },
  backlogStatus: { ok: true, counts: { ready: 2, review: 1, waiting: 0, cooling: 0, blocked: 0, approval: 0 },
    next: [
      { id: "task_d", kind: "task", stage: "ready", title: "Keyboard shortcut for new note" },
      { id: "task_e", kind: "task", stage: "ready", title: "Dark mode for the editor" },
    ], approval: [], blocked: [], summary: "2 ready · 2 building", waiting: null },
  assistantDoneLog: { ok: true, entries: [
    { at: now - 3 * M, kind: "build", title: "Export notes as Markdown", ok: true, taskId: "task_c", detail: "reported done in 6m 12s" },
    { at: now - 300 * M, kind: "build", title: "Pin favourite notes", ok: true, taskId: "task_f", detail: "reported done in 14m" },
  ] },
  machineStatus: { capacity: { resources: { availableMemoryMB: 7412, lagMs: 14 } }, leases: { busy: false, exclusive: false }, wait: false },
  usageTracker: { ok: false, error: "No calls recorded yet today." },
  opencodeCredits: { ok: true, fetchedAt: now, usage: goWindows },
  usageAccounts: { ok: true, at: now, accounts: [
    { provider: "opencode-go", label: "OpenCode Go", kind: "plan", read: "windows", connected: true, ok: true, fetchedAt: now, usage: goWindows },
  ] },
  jevStatus: { ok: true, status: { state: "ready", route: "zen", enabled: true, configured: true, lastSuccessAt: now - 6 * M } },
  brainsCatalog: { ok: true, catalog: brains.catalog() },
  brainsState: { ok: true, projectId: "p1", activeId: map.id, maps: maps.map((item) => brains.summarize(item, { maps })) },
  brainsRead: { ok: true, map, compiled: brains.compileMap(map, { maps }), active: true },
  brainsValidate: { ok: true, map, result: brains.validateMap(map, { maps }), compiled: brains.compileMap(map, { maps }) },
  brainsGatePlan: { ok: true, mapId: map.id, name: map.name, gates: brains.gatesFor(map), current: {}, changes: [], moves: [] },
  planningList: { ok: true, projectId: "p1", plans: [] },
  cliStatus: [
    { id: "opencode", name: "OpenCode", installed: true },
    { id: "claude", name: "Claude Code", installed: true },
    { id: "grok", name: "Grok", installed: false },
    { id: "codex", name: "Codex", installed: false },
    { id: "antigravity", name: "Antigravity", installed: false },
  ],
  getAiRouting: { provider: "auto", modelSelection: "jev", autoFallback: true, autoOrder: ["zai", "opencode", "claude", "lmstudio"], hasZai: true, hasOpenCode: false, hasCustom: false },
};

// Sample project, system map and pipelines. No live stores or provider calls.
const systemNames = ["Editor", "Search", "Library", "Export", "Design", "Checks"];
const systems = systemNames.map((name, i) => ({
  id: name.toLowerCase(), name, path: `src/${name.toLowerCase()}`, what: ["A focused writing space", "Find the right note", "Organize your ideas", "Take your work anywhere", "A consistent interface", "Evidence for every change"][i],
  fileCount: 8 + i * 3, warmth: .3 + i * .1, edits: 4 + i, taskIds: i === 0 ? ["task_a"] : i === 1 ? ["task_b"] : [],
  tasks: { open: 1, active: i < 2 ? 1 : 0, done: i + 1 },
  files: ["index.js", "view.js", "styles.css", "actions.js", "helpers.js", "view.test.js"].map((file, k) => ({path:`src/${name.toLowerCase()}/${file}`,present:true,edits:9-k,reads:14-k})),
}));
for (const system of systems) system.catalog = system.files;
seed.brainMap = {ok:true,map:{systems, links:[{from:"editor",to:"library",strength:.8},{from:"search",to:"library",strength:.65},{from:"editor",to:"design",strength:.7},{from:"export",to:"library",strength:.6},{from:"checks",to:"editor",strength:.5}],builtAt:now,sources:{present:93,commits:48,runs:12}},places:{ideas:{i1:"library",i2:"editor"},plans:{}}};
const steps = [
  {id:"s1",kind:"read",title:"Read the brief",parents:[],status:"done"},
  {id:"s2",kind:"map",title:"Map the files",parents:["s1"],status:"done"},
  {id:"s3",kind:"build",title:"Build empty state",parents:["s2"],status:"active",child:true,owner:"task_a"},
  {id:"s4",kind:"build",title:"Add keyboard action",parents:["s2"],status:"active",child:true,owner:"task_b"},
  {id:"s5",kind:"test",title:"Run the checks",parents:["s3","s4"],status:"queued"},
  {id:"s6",kind:"verify",title:"Verify the result",parents:["s5"],status:"queued"},
].map(s=>({...s,folded:false,model:"Connected builder",startedAt:now-60000}));
seed.brainState = {ok:true,pipelines:{task_a:{v:1,taskId:"task_a",source:"recipe",recipeId:"feature",recipeName:"Interface feature",steps,summary:{done:2,total:6},createdAt:now-60000,updatedAt:now}},running:seed.assistantStatus.status.running,recent:[]};
const recipes = ["Interface feature","Small bug fix","Add a test","Refactor a module"].map((name,i)=>({id:`recipe-${i}`,name,runs:8+i*2,verified:7+i*2,failed:1,pinned:i===0,retired:false,medianMs:240000,shape:{intent:i===1?"fix":"feature",complexity:"small"},steps:steps.map((s,k)=>({kind:s.kind,title:s.title,parents:k?[k-1]:[]}))}));
seed.brainPlaybook = {ok:true,recipes,shelf:recipes.map(r=>({...r,tone:"good",thickness:2,verifiedRate:r.verified/r.runs}))};
seed.companionState = {ok:true,state:"working",look:"wisp",scope:"project",queue:{counts:{total:1},items:[]},digest:{text:"Two builders are working on your Notes app."}};
seed.brainSettings = {ok:true,lead:{provider:"zen",model:"gpt-6-sol",effort:"medium"},desk:{provider:"zen",model:"gpt-6-sol",effort:"medium"}};
seed.projectPreviewStatus = {ok:true,phase:"stopped",available:true,kind:"static",message:"Preview is ready to start",logs:[]};
seed.prefsGet.prefs = {commandHome:false,autoReference:false,demoPanel:false};
seed.getAiRouting = {...seed.getAiRouting,provider:"openrouter",hasOpenRouter:true,openrouterModel:"openrouter/free"};
seed.openrouterModels = {ok:true,models:[{id:"openrouter/free",name:"Free router"}]};
seed.backlogStatus.taskStates = seed.tasksList.tasks.map((task,i)=>({id:task.id,stage:i<2?"running":i===2?"awaiting_verification":i===5?"done":"ready",reason:i<2?"Worker running":""}));
seed.tasksList.tasks[0].status = "active";
seed.tasksList.tasks[1].status = "active";
seed.tasksList.tasks[2].status = "awaiting_verification";
seed.assistantStatus.status.running.forEach((run,i)=>Object.assign(run,{runId:`demo-run-${i}`,route:"OpenCode",currentStep:i?"Adding the tag filter":"Building the empty-state component",lastOutputAt:now,phase:"running"}));
seed.assistantState.state.messages = seed.assistantState.state.messages.slice(0,4);

const bridge = `
<script>
(() => {
  const seed = ${JSON.stringify(seed)};
  const catalog = ${JSON.stringify(catalog)};
  const subs = {};
  // Calls whose answer depends on the argument.
  const dynamic = {
    getApiKey: (which) => ({ ok: true, saved: ["zai","zen","openrouter"].includes(which) }),
    prefsSet: (patch) => ({ok:true,prefs:Object.assign(seed.prefsGet.prefs,patch)}),
  };
  window.__seed = seed; window.__subs = subs;
  window.mefiStudio = new Proxy({}, {
    get(_, key) {
      if (typeof key !== "string") return undefined;
      if (key === "then") return undefined;
      if (key.startsWith("on")) return (cb) => { (subs[key] ??= []).push(cb); return () => {}; };
      if (key === "readCatalog" || key === "refreshCatalog") return async () => catalog;
      if (key in dynamic) return async (...args) => dynamic[key](...args);
      if (key in seed) return async () => JSON.parse(JSON.stringify(seed[key]));
      return async () => ({ ok: true });
    },
    has() { return true; },
  });
  try {
    localStorage.setItem("mefiStudio.zen", "0");
    localStorage.setItem("mefiStudio.commandHome", "0");
    localStorage.setItem("mefiStudio.keyHint.v1", "1");
    localStorage.setItem("mefiStudio.walkthrough.v1", JSON.stringify({version:1,step:6,status:"complete"}));
  } catch {}
})();
</script>
`;

const html = fs.readFileSync(path.join(IN, "booklet.html"), "utf8");
const at = html.indexOf("</title>") + "</title>".length;
if (at < "</title>".length) throw new Error("no </title> in the booklet");
fs.writeFileSync(path.join(OUT, "index.html"), html.slice(0, at) + bridge + html.slice(at), "utf8");
fs.cpSync(path.join(ROOT,"assets"),path.join(HERE,"assets"),{recursive:true});
console.log("wrote", path.join(OUT, "index.html"), "brain map nodes:", map.nodes.length);
