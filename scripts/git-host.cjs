"use strict";
// Mefi's Studio AI+ — the GitHub link's host layer: the one object main.cjs
// calls from its git:* and projects:glance handlers, between the Electron
// bridge and the two finished modules under it. scripts/git-link.cjs decides
// what a state is called (describe, chip, classifyPush); scripts/git-actions.cjs
// does the looking and the doing (glance, save, pushBranch, publish, link);
// this module does the thinking in between, so main.cjs keeps one-line hooks:
//
//   which project     every project-bound call captures the open project once
//                     (context()) and uses only that root for everything it
//                     does; a call for another project id is refused
//   one writer        pull, push, rebase, save, publish and link run one at a
//                     time in the order asked (a step that goes through
//                     syncProject, which works on whichever project is open,
//                     is refused if that is no longer the one asked for);
//                     while one runs the chip model
//                     carries what it is doing and goes out on git:state at
//                     its start, at each phase and at its end
//   which push        the default branch with an upstream goes through
//                     syncProject(true), so the check gate, the lost-work guard,
//                     the vault heartbeat and coworkPushed keep firing; any other
//                     branch, or a first push, goes through pushBranch with the
//                     project's own check; nothing is ever forced
//   the chip model    glance (local, no network) + the last sync result for the
//                     project + the account as last asked + what is running +
//                     the outcome of the last action (kept 6 s) + a refusal that
//                     still stands, all fed to git-link's describe
//
// No Electron, no ipcMain, no timers and no I/O of its own: everything arrives
// through the factory (actions, link, context, listProjects, syncProject,
// projectCheck, pcSetup, send, exists, now), like scripts/agent-brain-host.cjs
// and scripts/pc-setup.cjs. The state it holds (caches per project, the account
// as last asked, the queue) is why it is a host module and not a pure one.
// Nothing here takes a path, an address or a command from the caller beyond
// `paths` (which actions.save re-checks against its own preview) and `repo`
// (which actions.link re-checks against pcSetup.isListed). Every string that
// leaves passes through link.scrub. Guarded by tests/git_host.test.mjs.
//
// The success state expires by the injected clock, not a timer: whoever draws
// the chip asks state() again a little after 6 s (or on any later event).
const path = require("node:path");

const OUTCOME_MS = 6000;
const PATH_CAP = 5000;
const PROJECT_CAP = 500; // a launch list longer than this is not looked at past here (the sync existsSync calls alone would stall the app)

const SAY = Object.freeze({
  noProject: "Open a project first.",
  changed: "The selected project changed. Try again in its intended project.",
  builders: "Agents are still changing files in this project. Pull now anyway?",
  syncFailed: "Sync could not run.",
});

const isObject = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const finite = (value) => Number.isFinite(value);
const count = (value) => (finite(value) && value > 0 ? Math.floor(value) : 0);
const str = (value, cap = 500) => (typeof value === "string" ? value.slice(0, cap) : "");

// Two spellings of one folder are one key (Windows folds case and slashes).
function keyOf(folder) {
  const resolved = path.resolve(String(folder)).replace(/[\\/]+$/, "");
  return path.sep === "\\" ? resolved.toLowerCase() : resolved;
}

// Whether a sync result could be about this folder: the same one, or the repository around it.
function related(rootA, rootB) {
  const a = keyOf(rootA);
  const b = keyOf(rootB);
  if (a === b) return true;
  const inside = (child, parent) => child.startsWith(parent) && /[\\/]/.test(child[parent.length] ?? "");
  return inside(a, b) || inside(b, a);
}

function createGitHost({
  actions, link, context, listProjects, syncProject, projectCheck, pcSetup, send, exists, now = () => Date.now(), later = null,
} = {}) {
  const clock = () => (typeof now === "function" ? now() : Date.now());
  // Whatever was thrown (a Symbol, an object with no toString) becomes a sentence; saying it never throws.
  const say = (error) => {
    try { return link.scrub(error?.message ?? error) || SAY.syncFailed; } catch { return SAY.syncFailed; }
  };
  const failed = (error, extra = {}) => ({ ok: false, error: say(error), ...extra });

  // Every string in a result that leaves this module is scrubbed of logins and tokens.
  function clean(value, depth = 0) {
    if (typeof value === "string") return link.scrub(value);
    if (depth > 6) return typeof value === "object" && value ? null : value; // too deep to vouch for: dropped, not passed on unscrubbed
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) return value.map((item) => clean(item, depth + 1));
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clean(item, depth + 1)]));
  }

  // ---- what is remembered ------------------------------------------------------
  // Per project (by folder): the last sync result, when it looked, the refusal
  // or failed check still standing, and the action that just finished.
  const entries = new Map();
  const entryFor = (root) => {
    const key = keyOf(root);
    if (!entries.has(key)) entries.set(key, { sync: null, checkedAt: null, refusal: null, problem: null, outcome: null });
    return entries.get(key);
  };
  // The account as last asked: undefined = never asked (never "signed out"),
  // else { account: name|null, ghInstalled } (the name only, never a token).
  let who;
  let busy = null; // { kind, key } of the writer running
  const checking = new Map(); // key -> looks in flight
  let last = null;
  let epoch = 0; // moves with every project change: an answer for an older one is not sent
  let tail = Promise.resolve();

  function noteAccount(next) {
    const before = who;
    who = { account: typeof next?.account === "string" && next.account ? next.account : null, ghInstalled: next?.ghInstalled !== false };
    return !before || before.account !== who.account || before.ghInstalled !== who.ghInstalled;
  }
  // A commit identity from the signed-in login, for a PC where git has none (actions uses it only then).
  const identity = () => (who?.account ? { name: who.account, email: `${who.account}@users.noreply.github.com` } : null);

  // ---- which project ------------------------------------------------------------
  function read() {
    let raw = null;
    try { raw = context(); } catch { raw = null; }
    const root = isObject(raw) && typeof raw.root === "string" && raw.root ? raw.root : null;
    if (!root) return null;
    return { root, projectId: raw.projectId ?? null, builders: raw.builders === true, epoch };
  }
  function bind(o) {
    const ctx = read();
    if (!ctx) return { failure: { ok: false, error: SAY.noProject } };
    const wanted = isObject(o) ? o.projectId : undefined;
    if (wanted !== undefined && wanted !== null && wanted !== "" && wanted !== ctx.projectId) return { failure: { ok: false, error: SAY.changed } };
    return { ctx };
  }

  // ---- the chip model -------------------------------------------------------------
  async function build(ctx) {
    const entry = entryFor(ctx.root);
    const key = keyOf(ctx.root);
    // Expired after OUTCOME_MS; one stamped in the future (the clock stepped back) or without a time is not kept either.
    if (entry.outcome) { const age = clock() - entry.outcome.at; if (!(age >= 0 && age < OUTCOME_MS)) entry.outcome = null; }
    let glance = null;
    try { glance = await actions.glance(ctx.root); } catch { glance = null; }
    const running = busy && busy.key === key ? busy.kind : checking.get(key) ? "checking" : null;
    // A failed project check from pushBranch reads like the one sync.mjs records.
    const sync = entry.problem ? { ...(entry.sync ?? {}), problems: [...(Array.isArray(entry.sync?.problems) ? entry.sync.problems : []), entry.problem] } : entry.sync;
    const input = {
      glance, sync, account: who, busy: running, outcome: entry.outcome, refusal: entry.refusal,
      checkedAt: entry.checkedAt, agentsBuilding: ctx.builders, project: {},
    };
    // The model is scrubbed like everything else that leaves: a branch name, a commit subject or a file name can hold a token.
    // The model says which project it is about, so an action drawn for one project is refused after a switch to another.
    const about = { projectId: typeof ctx.projectId === "string" ? ctx.projectId : null };
    try { return { ...clean(link.describe(input)), ...about }; } catch { return { ...clean(link.describe({})), ...about }; }
  }
  function emit(model, ctx) {
    if (ctx.epoch !== epoch) return;
    last = model;
    try { send?.("git:state", model); } catch { /* a closed window is not this module's problem */ }
  }
  async function refresh(ctx) {
    const model = await build(ctx);
    emit(model, ctx);
    return model;
  }

  // The success state ends by itself: the renderer draws whatever it was last sent
  // and asks for a new model only on a project change or a return to the window, so
  // a chip that still says "Pushed 2 commits" would stay that way. `later` (main.cjs
  // hands over an unref'd timer; without one nothing is scheduled) brings the model
  // back a moment after OUTCOME_MS, unless another action or project has taken over.
  function settle(ctx) {
    const shown = entryFor(ctx.root).outcome;
    if (!shown || typeof later !== "function") return;
    try {
      later(OUTCOME_MS + 250, async () => {
        try {
          const now = read();
          if (!now || now.epoch !== ctx.epoch || keyOf(now.root) !== keyOf(ctx.root) || now.projectId !== ctx.projectId) return;
          if (entryFor(ctx.root).outcome !== shown) return;
          await refresh(now);
        } catch { /* a timer must never break the host */ }
      });
    } catch { /* no timer, no expiry push: the next state() still expires it */ }
  }

  // ---- one writer at a time ----------------------------------------------------------
  // The next writer waits its turn; the model says what the running one is doing.
  function writer(kind, ctx, task) {
    const key = keyOf(ctx.root);
    const run = async () => {
      let result;
      try {
        const entry = entryFor(ctx.root);
        entry.refusal = null;
        entry.problem = null;
        entry.outcome = null;
        busy = { kind, key };
        await refresh(ctx);
        const phase = async (next) => { busy = { kind: next, key }; await refresh(ctx); };
        result = await task(phase);
      } catch (error) { result = failed(error); } finally { busy = null; } // whatever happened, the chip stops saying it is working
      if (!isObject(result)) result = failed(SAY.syncFailed);
      try { result.model = await refresh(ctx); } catch { /* the answer still goes out, only without a fresh chip */ }
      settle(ctx);
      return result;
    };
    const next = tail.then(run, run);
    tail = next.then(() => {}, () => {});
    return next;
  }

  // ---- talking to sync ----------------------------------------------------------------
  function store(ctx, result) {
    if (!isObject(result)) return;
    const rr = result.state?.root;
    if (typeof rr === "string" && !related(rr, ctx.root)) return;
    const entry = entryFor(ctx.root);
    entry.sync = result;
    entry.checkedAt = finite(result.checkedAt) ? result.checkedAt : clock();
  }
  // syncProject works on whichever project is open when it starts, not on a root we hand it:
  // an answer queued behind another writer must not run once the owner has opened a different one.
  function stillOpen(ctx) {
    const now = read();
    return Boolean(now) && keyOf(now.root) === keyOf(ctx.root) && now.projectId === ctx.projectId;
  }
  async function callSync(ctx, ...args) {
    if (!stillOpen(ctx)) return { threw: SAY.changed };
    let result = null;
    try { result = await syncProject(...args); } catch (error) { return { threw: say(error) }; }
    store(ctx, result);
    return { result };
  }
  // What the sync answered: did it do what was asked, and if not, why.
  function judge({ result, threw }) {
    if (threw !== undefined) return { ok: false, errored: true, error: threw };
    if (!isObject(result)) return { ok: false, errored: true, error: SAY.syncFailed };
    const problems = Array.isArray(result.problems) ? result.problems.filter(isObject) : [];
    if (result.ok === true && !problems.length) return { ok: true };
    const bad = problems.find((item) => item.kind === "push-refused");
    return {
      ok: false, error: link.scrub(str(result.headline, 2000) || str(problems[0]?.detail, 2000) || SAY.syncFailed),
      ...(bad ? { refusal: clean(link.classifyPush(str(bad.stderr, 4000) || str(bad.detail, 4000))) } : {}),
      errored: problems.some((item) => item.kind === "error"),
    };
  }
  function outcomeOf(result) {
    const done = Array.isArray(result?.actions) ? result.actions.filter(isObject) : [];
    const pick = (kind) => done.find((item) => item.kind === kind);
    for (const kind of ["pushed", "rebased", "pulled"]) {
      const found = pick(kind);
      if (found) return { kind, commits: count(found.commits), at: clock() };
    }
    return null;
  }
  // A sync-backed action: run it, remember the answer, set the outcome.
  async function viaSync(ctx, ...args) {
    const answer = await callSync(ctx, ...args);
    const verdict = judge(answer);
    if (verdict.ok) {
      const outcome = outcomeOf(answer.result);
      if (outcome) entryFor(ctx.root).outcome = outcome;
    }
    return { ...verdict, commits: outcomeOf(answer.result)?.commits ?? 0 };
  }

  // ---- pushing --------------------------------------------------------------------------
  // The default branch with an upstream keeps sync's gates; anything else is pushBranch.
  async function pushNow(ctx) {
    const entry = entryFor(ctx.root);
    let g = null;
    try { g = await actions.glance(ctx.root); } catch { g = null; }
    if (g && g.available === false) return failed(link.STATES["folder-missing"].sentence);
    if (g && g.isRepo === false) return failed(link.STATES["not-repo"].sentence);
    let throughSync;
    if (g) throughSync = g.onDefault === true && g.detached !== true && !g.unborn && Boolean(g.upstream);
    else { const state = entry.sync?.state; throughSync = Boolean(state?.repo && state.hasUpstream && state.branch === state.main); }
    if (throughSync) {
      const verdict = await viaSync(ctx, true);
      return verdict.ok ? { ok: true, commits: verdict.commits } : failed(verdict.error, verdict.refusal ? { refusal: verdict.refusal } : {});
    }
    // A check that cannot be read is not a check that passed: the push waits (sync does the same when its check throws).
    let check = null;
    if (typeof projectCheck === "function") {
      try { check = await projectCheck(ctx.root); } catch (error) {
        const detail = say(error);
        entry.problem = { kind: "check-failed", detail };
        return failed(`The project's check could not be run, so nothing was pushed. ${detail}`.trim());
      }
    }
    const res = await actions.pushBranch(ctx.root, { check });
    if (res?.ok) {
      const commits = count(res.commits);
      entry.outcome = { kind: "pushed", commits, at: clock() };
      return { ok: true, commits };
    }
    const refusal = isObject(res?.refusal) ? clean(res.refusal) : null;
    // A refusal git-link words as a state stays on the chip; the rest is only the error.
    if (refusal && typeof refusal.state === "string") entry.refusal = refusal;
    if (res?.kind === "check-failed") entry.problem = { kind: "check-failed", detail: link.scrub(str(res.detail, 2000)) };
    return failed(res?.error || SAY.syncFailed, refusal ? { refusal } : {});
  }

  // ---- the methods main.cjs calls -----------------------------------------------------------
  const guard = (task, fallback = (error) => failed(error)) => async (...args) => {
    try { return await task(...args); } catch (error) { return fallback(error); }
  };

  async function state(o) {
    const b = bind(o);
    if (b.failure) return b.failure;
    const model = await build(b.ctx);
    if (b.ctx.epoch === epoch) last = model;
    return { ok: true, model };
  }

  async function check(o) {
    const b = bind(o);
    if (b.failure) return b.failure;
    const { ctx } = b;
    const key = keyOf(ctx.root);
    checking.set(key, (checking.get(key) ?? 0) + 1);
    let verdict;
    try {
      await refresh(ctx);
      verdict = judge(await callSync(ctx, false));
    } finally {
      const left = (checking.get(key) ?? 1) - 1;
      if (left > 0) checking.set(key, left); else checking.delete(key);
    }
    const model = await refresh(ctx);
    // Offline, a lapsed sign-in and a divergence are states the chip shows; only a sync that could not run is an error.
    return verdict.errored ? { ok: false, error: verdict.error, model } : { ok: true, model };
  }

  async function pull(o) {
    const b = bind(o);
    if (b.failure) return b.failure;
    const { ctx } = b;
    if (ctx.builders && !(isObject(o) && o.anyway === true)) {
      return { ok: false, needsConfirm: "builders", error: SAY.builders, model: await refresh(ctx) };
    }
    return writer("pulling", ctx, async () => {
      // Agents may have started while this waited its turn: the question is asked again then, not answered with the old "no".
      if (!(isObject(o) && o.anyway === true)) {
        const now = read();
        if (now && now.builders && keyOf(now.root) === keyOf(ctx.root)) return { ok: false, needsConfirm: "builders", error: SAY.builders };
      }
      const verdict = await viaSync(ctx, false, { pullOnly: true });
      return verdict.ok ? { ok: true } : failed(verdict.error);
    });
  }

  async function push(o) {
    const b = bind(o);
    if (b.failure) return b.failure;
    return writer("pushing", b.ctx, async () => {
      const pushed = await pushNow(b.ctx);
      return pushed.ok ? { ok: true } : failed(pushed.error, pushed.refusal ? { refusal: pushed.refusal } : {});
    });
  }

  async function rebase(o) {
    const b = bind(o);
    if (b.failure) return b.failure;
    return writer("pushing", b.ctx, async () => {
      const verdict = await viaSync(b.ctx, true, { rebase: true });
      return verdict.ok ? { ok: true } : failed(verdict.error);
    });
  }

  async function savePreview(o) {
    const b = bind(o);
    if (b.failure) return b.failure;
    return clean(await actions.preview(b.ctx.root, { builders: b.ctx.builders, identity: identity() }));
  }

  async function save(o) {
    const b = bind(o);
    if (b.failure) return b.failure;
    const { ctx } = b;
    const input = isObject(o) ? o : {};
    const paths = (Array.isArray(input.paths) ? input.paths : []).filter((item) => typeof item === "string" && item).slice(0, PATH_CAP);
    return writer("saving", ctx, async (phase) => {
      const entry = entryFor(ctx.root);
      const res = await actions.save(ctx.root, {
        paths, message: str(input.message, 5000), builders: ctx.builders, ignoreBuilders: input.ignoreBuilders === true, identity: identity(),
      });
      if (!res?.ok) {
        const refusal = isObject(res?.refusal) ? clean(res.refusal) : null;
        if (refusal && typeof refusal.state === "string") entry.refusal = refusal;
        return failed(res?.error || "Could not save.", {
          ...(res?.kind ? { kind: res.kind } : {}), ...(isObject(res?.blocked) ? { blocked: clean(res.blocked) } : {}), ...(refusal ? { refusal } : {}),
        });
      }
      const saved = { ok: true, sha: res.sha, files: res.files };
      entry.outcome = { kind: "saved", files: count(res.files), at: clock() };
      if (input.push !== true) return saved;
      await phase("pushing");
      const pushed = await pushNow(ctx);
      // The save landed: it stays ok, and `pushed: false` (with why) is what the dialog turns into
      // "Saved N files on this PC, but nothing was pushed". Answering ok:false here would leave it
      // open on files that are already committed, and a second press would fail as "not one of the changed files".
      if (!pushed.ok) return { ...saved, pushed: false, error: pushed.error, ...(pushed.refusal ? { refusal: pushed.refusal } : {}) };
      if (entry.outcome) entry.outcome.files = count(res.files);
      return { ...saved, pushed: true };
    });
  }

  async function owners() {
    const res = clean(await actions.owners());
    let changed = false;
    if (res?.ok) changed = noteAccount({ account: res.account, ghInstalled: true });
    else if (res?.kind === "not-signed-in") changed = noteAccount({ account: null, ghInstalled: true });
    else if (res?.kind === "gh-missing") changed = noteAccount({ account: null, ghInstalled: false });
    if (changed) { const ctx = read(); if (ctx) await refresh(ctx); }
    return res;
  }

  async function account() {
    const res = clean(await actions.account());
    if (res?.ok !== false) {
      const changed = noteAccount(res);
      if (changed) { const ctx = read(); if (ctx) await refresh(ctx); }
    }
    return { ok: res?.ok !== false, account: typeof res?.account === "string" && res.account ? res.account : null, ghInstalled: res?.ghInstalled !== false, gitInstalled: res?.gitInstalled !== false };
  }

  async function publishPreview(o) {
    const b = bind(o);
    if (b.failure) return b.failure;
    const input = isObject(o) ? o : {};
    const res = clean(await actions.publishPreview(b.ctx.root, {
      owner: str(input.owner, 100), name: str(input.name, 200), gitignore: input.gitignore !== false, license: str(input.license, 40) || "none",
    }));
    if (res?.ok && typeof res.ghInstalled === "boolean" && noteAccount({ account: res.account, ghInstalled: res.ghInstalled })) await refresh(b.ctx);
    // The Publish dialog and New app read the name's own complaint as `issue`; actions keeps
    // it as `nameIssue` beside `publishIssue` (the folder's), so both spellings go out.
    if (isObject(res) && typeof res.nameIssue === "string" && res.nameIssue && typeof res.issue !== "string") res.issue = res.nameIssue;
    return res;
  }

  async function publish(o) {
    const b = bind(o);
    if (b.failure) return b.failure;
    const { ctx } = b;
    const input = isObject(o) ? o : {};
    return writer("publishing", ctx, async () => {
      const entry = entryFor(ctx.root);
      const res = clean(await actions.publish(ctx.root, {
        owner: str(input.owner, 100), name: str(input.name, 200), visibility: input.visibility === "public" ? "public" : "private",
        description: str(input.description, 350), gitignore: input.gitignore !== false, license: str(input.license, 40) || "none",
        confirmPublic: str(input.confirmPublic, 300), identity: identity(),
      }));
      const steps = Array.isArray(res?.steps) ? res.steps : [];
      if (!res?.ok) {
        if (res?.kind === "not-signed-in") noteAccount({ account: null, ghInstalled: true });
        else if (res?.kind === "gh-missing") noteAccount({ account: null, ghInstalled: false });
        return { ...(isObject(res) ? res : {}), ok: false, error: say(res?.error || "Could not publish."), steps };
      }
      // The folder has an origin now: what an older look said about "no remote" is history.
      entry.sync = null;
      entry.checkedAt = null;
      entry.outcome = { kind: "published", repo: str(res.repo, 200), visibility: res.visibility === "public" ? "public" : "private", at: clock() };
      return { ...res, ok: true, steps };
    });
  }

  async function linkRepos() {
    try {
      const res = await pcSetup.repos();
      return isObject(res) ? clean(res) : failed("Could not list your GitHub repositories.");
    } catch (error) { return failed(error); }
  }

  async function linkTo(o) {
    const b = bind(o);
    if (b.failure) return b.failure;
    const { ctx } = b;
    const repo = isObject(o) ? str(o.repo, 200) : "";
    return writer("checking", ctx, async () => {
      const entry = entryFor(ctx.root);
      const res = clean(await actions.link(ctx.root, { repo, isListed: pcSetup.isListed }));
      if (!res?.ok) return { ...(isObject(res) ? res : {}), ok: false, error: say(res?.error || "Could not link this folder.") };
      entry.sync = null;
      entry.checkedAt = null;
      return { ...res, ok: true };
    });
  }

  // The launch list: a chip for each project, local only, never throwing.
  async function glance(ids) {
    try {
      const listed = (() => { try { const value = listProjects(); return Array.isArray(value) ? value : []; } catch { return []; } })()
        .filter((project) => isObject(project) && typeof project.id === "string" && typeof project.path === "string" && project.path);
      const wanted = Array.isArray(ids) ? new Set(ids.filter((id) => typeof id === "string")) : null;
      const projects = listed.filter((project) => !wanted || wanted.has(project.id)).slice(0, PROJECT_CAP);
      const present = (project) => { try { return typeof exists === "function" ? Boolean(exists(project.path)) : true; } catch { return false; } };
      const availability = projects.map(present);
      const item = (project, avail, g) => {
        let model = null;
        try { model = link.describe({ glance: g, sync: entries.get(keyOf(project.path))?.sync ?? null, account: who }); } catch { model = null; }
        return {
          id: project.id, available: avail, chip: model ? link.chip(model) : null, branch: model?.branch ?? null, repo: model?.repo ?? null,
          ahead: model?.counts?.ahead ?? 0, behind: model?.counts?.behind ?? 0, dirty: model?.counts?.dirty ?? 0,
        };
      };
      const found = projects.filter((_, index) => availability[index]);
      let looked = [];
      try { looked = await actions.glanceMany(found.map((project) => ({ id: project.id, root: project.path }))); } catch { looked = []; }
      const byId = new Map((Array.isArray(looked) ? looked : []).map((row) => [row?.id, row?.glance ?? null]));
      const items = projects.map((project, index) => (availability[index]
        ? item(project, true, byId.get(project.id) ?? null)
        : item(project, false, { isRepo: false, available: false })));
      return { ok: true, items: clean(items) };
    } catch (error) { return { ok: false, items: [], error: say(error) }; }
  }

  // A sync result arrived (Studio's own looks, or ours): keep it for its project and redraw.
  async function onSyncEvent(result) {
    try {
      if (!isObject(result)) return;
      const ctx = read();
      const rr = result.state?.root;
      // The same test store() applies: sync names the repository's top folder, which is the project's folder or one above it.
      if (!ctx || typeof rr !== "string" || !related(rr, ctx.root)) return;
      const entry = entryFor(ctx.root);
      entry.sync = result;
      entry.checkedAt = finite(result.checkedAt) ? result.checkedAt : clock();
      await refresh(ctx);
    } catch { /* an event must never break the sender */ }
  }

  // Another project is open (or none): nothing learned about the last one applies.
  async function onProjectChanged() {
    try {
      entries.clear();
      checking.clear();
      last = null;
      epoch += 1;
      const ctx = read();
      if (ctx) await refresh(ctx);
    } catch { /* same */ }
  }

  return {
    state: guard(state),
    check: guard(check),
    pull: guard(pull),
    push: guard(push),
    rebase: guard(rebase),
    savePreview: guard(savePreview),
    save: guard(save),
    owners: guard(owners),
    publishPreview: guard(publishPreview),
    publish: guard(publish),
    linkRepos,
    link: guard(linkTo),
    account: guard(account, (error) => ({ ok: false, account: null, ghInstalled: false, gitInstalled: false, error: say(error) })),
    glance,
    onSyncEvent,
    onProjectChanged,
    model: () => last,
  };
}

module.exports = { createGitHost, OUTCOME_MS };
