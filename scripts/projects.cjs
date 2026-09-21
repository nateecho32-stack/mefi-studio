// Local project identity and storage boundaries. A captured project never changes
// when the selected project changes, including work that resumes after an await.
//
// Projects are shown only when the user chose the folder. The app seeds its own
// working root as an internal legacy store so old unscoped data stays reachable
// when that folder is added again, but the seed is never listed, selected or
// saved as a project by itself: a fresh install starts with no project open.
const path = require("node:path");
const crypto = require("node:crypto");
const { AsyncLocalStorage } = require("node:async_hooks");
const { mkdir } = require("node:fs/promises");
// Folder containment lives in scripts/path-scope.cjs so the store reader
// (scripts/eyes.mjs) scopes sessions by the same rule this facade applies.
const { pathKey, containsPath } = require("./path-scope.cjs");

// How long one facade trusts its list of the project's session ids. Store
// reads are asynchronous and cost a worker round trip each, so the scope set
// is shared across the reads of one operation (watcher pass, chat reply)
// instead of being rebuilt per call.
const SESSION_SCOPE_MS = 2000;

function projectFromPath(value, { name, legacy = false, explicit = false } = {}) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new TypeError("Choose an absolute project folder.");
  const root = path.resolve(value);
  return Object.freeze({
    id: `project_${crypto.createHash("sha256").update(pathKey(root)).digest("hex").slice(0, 16)}`,
    name: String(name || path.basename(root) || root).slice(0, 100),
    path: root,
    ...(legacy ? { legacy: true } : {}),
    ...(explicit ? { explicit: true } : {}),
  });
}

function createProjects({ defaultRoot, studioRoot, saved = {}, preferredRoot = null, isDirectory = () => true }) {
  const context = new AsyncLocalStorage();
  const legacyRoot = typeof saved?.legacyPath === "string" && path.isAbsolute(saved.legacyPath) ? saved.legacyPath : defaultRoot;
  const legacy = projectFromPath(legacyRoot, { legacy: true });
  const projects = new Map([[legacy.id, legacy]]);
  const exposed = (project) => (project.exposed === true ? project : project.placeholder === true ? null : Object.freeze({ ...project, exposed: true }));
  const hidden = (project) => {
    const { exposed: _exposed, explicit: _explicit, ...rest } = project;
    return Object.freeze(rest);
  };
  for (const item of Array.isArray(saved?.items) ? saved.items : []) {
    try {
      const project = projectFromPath(item.path, { name: item.name, explicit: item.explicit === true });
      // Migration: settings written before projects became opt-in carry the
      // app's own root as a saved project. Drop that seed unless the folder was
      // chosen again after this rule existed (explicit), and never let it
      // replace the hidden legacy identity that owns the old unscoped data.
      if (pathKey(project.path) === pathKey(defaultRoot) && item.explicit !== true) continue;
      if (!projects.has(project.id)) projects.set(project.id, exposed(project));
      else if (project.explicit) projects.set(project.id, exposed({ ...projects.get(project.id), explicit: true }));
    } catch {}
  }
  // MEFI_STUDIO_REPO names the working repository outright; a headless or
  // developer launch gets it open without saving it as a lasting user choice.
  let preferred = null;
  if (preferredRoot && path.isAbsolute(preferredRoot)) {
    const project = projectFromPath(preferredRoot);
    preferred = exposed(projects.has(project.id) ? { ...projects.get(project.id) } : project);
    projects.set(preferred.id, preferred);
  }
  // No project is open on a fresh install. Storage still needs a stable scope,
  // so the placeholder owns an empty store of its own until a folder is added.
  const placeholder = Object.freeze({ id: "project_none", name: "No project", path: path.join(studioRoot, ".no-project"), placeholder: true });
  const exposedProjects = () => [...projects.values()].filter((project) => project.exposed === true);
  const firstOpenable = () => exposedProjects().find((project) => isDirectory(project.path)) ?? null;
  const resolveActive = () => {
    for (const candidate of [preferred, projects.get(saved?.activeId)]) {
      if (candidate?.exposed === true && isDirectory(candidate.path)) return candidate;
    }
    return firstOpenable() ?? placeholder;
  };
  let active = resolveActive();
  const open = () => (active.exposed === true ? active : null);
  const current = () => context.getStore() || active;
  const list = () => {
    const openProject = open();
    return { ok: true, projects: exposedProjects(), activeId: openProject?.id ?? null, activeProject: openProject };
  };
  const stamp = (row, project = current()) => row && typeof row === "object" ? { ...row, projectId: project.id, projectPath: project.path } : row;
  function dataPath(file, project = current()) {
    const dataRoot = path.join(studioRoot, "data");
    if (project.legacy) return file;
    if (!containsPath(dataRoot, file)) return file;
    const relative = path.relative(dataRoot, file);
    if (relative.split(path.sep)[0] === "projects") return file;
    // Catalog and credentials are app-wide; only operational files are scoped.
    if (["curated.json", "models.json"].includes(relative)) return file;
    return path.join(dataRoot, "projects", project.id, relative);
  }
  return {
    current, list, stamp, dataPath,
    run: (project, callback) => context.run(project, callback),
    active: () => active,
    open,
    hasProjects: () => exposedProjects().length > 0,
    find: (id) => {
      const project = projects.get(id);
      return project?.exposed === true ? project : undefined;
    },
    saved: () => {
      const openProject = open();
      return {
        activeId: openProject?.id ?? null,
        legacyPath: legacy.path,
        items: exposedProjects().map(({ id, name, path: projectPath, explicit }) => ({ id, name, path: projectPath, ...(explicit ? { explicit: true } : {}) })),
      };
    },
    add(value) {
      const project = projectFromPath(value);
      if (!isDirectory(project.path)) throw new Error("The selected project folder is unavailable.");
      const next = Object.freeze({ ...(projects.get(project.id) ?? project), exposed: true, explicit: true });
      projects.set(project.id, next);
      return next;
    },
    select(id) {
      const project = projects.get(id);
      if (!project || project.exposed !== true) throw new Error("Choose a project from your project list.");
      if (!isDirectory(project.path)) throw new Error("That project folder is unavailable. Reconnect it before switching.");
      active = project;
      return project;
    },
    // Removing never touches the folder or its local data. The hidden legacy
    // identity stays behind so adding the same folder again reads the same
    // store instead of starting a second one beside it.
    remove(id) {
      const project = projects.get(id);
      if (!project || project.exposed !== true) throw new Error("Choose a project from your project list.");
      if (project.legacy) projects.set(id, hidden(project));
      else projects.delete(id);
      const changed = active.id === id;
      if (changed) active = firstOpenable() ?? placeholder;
      return { removed: { id: project.id, name: project.name, path: project.path }, activeChanged: changed, activeId: open()?.id ?? null };
    },
    // One facade per operation binds all awaited reads/writes to its project.
    // No files are moved or rewritten just by listing or changing projects.
    eyes(eyes, project = current()) {
      const scoped = Object.create(null);
      Object.assign(scoped, eyes);
      const boardNames = new Set(["eyes-tasks.json", "eyes-requests.json", "eyes-feature-ideas.json"]);
      scoped.readJson = async (file, fallback) => {
        const rows = await eyes.readJson(dataPath(file, project), fallback);
        return boardNames.has(path.basename(file)) && Array.isArray(rows) ? rows.map((row) => stamp(row, project)) : rows;
      };
      scoped.writeJson = async (file, value) => {
        const target = dataPath(file, project);
        if (target !== file) await mkdir(path.dirname(target), { recursive: true });
        const rows = boardNames.has(path.basename(file)) && Array.isArray(value) ? value.map((row) => stamp(row, project)) : value;
        return eyes.writeJson(target, rows);
      };
      // The optional SQLite store is global. File storage remains the current
      // authority until SQLite gains an equivalent project partition.
      scoped.boardEnabled = () => false;
      // Store reads are asynchronous: the real module answers from the eyes
      // worker (scripts/eyes-client.cjs), so every scoped read returns a
      // promise, and a synchronous fixture module is simply awaited. The
      // project scope asks the store for the sessions under this folder
      // (listSessions root, listSessionIds) instead of listing the 400 newest
      // sessions of every project and filtering here: that floor cost 138 ms
      // warm and up to 2.6 s cold per read on a 17 GB store, and the A-Eyes
      // watch paid it every 2 s on the main thread.
      const inProject = (directory) => containsPath(project.path, directory);
      // One scope per store path (a fixture may name its own database); the
      // live app only ever reads the default store.
      const scopes = new Map();
      const sessionIds = (options = {}) => {
        const key = typeof options.dbPath === "string" ? options.dbPath : "";
        const store = options.dbPath ? { dbPath: options.dbPath } : {};
        const scope = scopes.get(key) ?? { ids: null, at: 0, pending: null };
        scopes.set(key, scope);
        if (scope.ids && Date.now() - scope.at < SESSION_SCOPE_MS) return Promise.resolve(scope.ids);
        if (scope.pending) return scope.pending;
        scope.pending = (async () => {
          const ids = typeof eyes.listSessionIds === "function"
            ? await eyes.listSessionIds({ ...store, root: project.path })
            : (await eyes.listSessions({ ...store, root: project.path, limit: 400 }) ?? []).filter((session) => inProject(session.directory)).map((session) => session.id);
          scope.ids = new Set(Array.isArray(ids) ? ids : []);
          scope.at = Date.now();
          return scope.ids;
        })().finally(() => { scope.pending = null; });
        return scope.pending;
      };
      const unavailableChecks = () => ({ available: false, checks: [], truncated: false, error: "Session check evidence is unavailable for this project" });
      if (eyes.readPins) scoped.readPins = (file) => eyes.readPins(dataPath(file, project));
      if (eyes.writePins) scoped.writePins = async (file, value) => {
        const target = dataPath(file, project);
        await mkdir(path.dirname(target), { recursive: true });
        return eyes.writePins(target, value);
      };
      if (eyes.listSessions) scoped.listSessions = async (options = {}) => {
        const limit = options.limit || 40;
        const rows = await eyes.listSessions({ ...options, root: project.path, limit });
        // A reader that ignores `root` (a fixture) still ends up scoped.
        return (Array.isArray(rows) ? rows : []).filter((session) => inProject(session.directory)).slice(0, limit);
      };
      if (eyes.findRunSession) scoped.findRunSession = async (options = {}) => {
        const session = await eyes.findRunSession(options);
        return session && inProject(session.directory) ? session : null;
      };
      if (eyes.listSessionChecks) scoped.listSessionChecks = async (options = {}) => {
        // Check one exact session directly rather than relying on the recent
        // session scope: verification may resume after a long outage.
        try {
          const sessionId = options.sessionId ?? "";
          const directory = typeof eyes.sessionDirectory === "function"
            ? await eyes.sessionDirectory({ dbPath: options.dbPath, sessionId })
            : eyes.openDb(options.dbPath).prepare("select directory from session where id = ?").get(sessionId)?.directory ?? null;
          if (!directory || !inProject(directory)) return unavailableChecks();
          return await eyes.listSessionChecks(options);
        } catch {
          return unavailableChecks();
        }
      };
      for (const method of ["listTodos", "listChanges", "listChatTexts", "activitySince"]) {
        if (typeof eyes[method] !== "function") continue;
        scoped[method] = async (options = {}) => {
          const [rows, ids] = await Promise.all([eyes[method](options), sessionIds(options)]);
          return (Array.isArray(rows) ? rows : []).filter((row) => ids.has(row.sessionId) && (!row.file || !path.isAbsolute(row.file) || inProject(row.file)));
        };
      }
      if (eyes.assistantFacts) scoped.assistantFacts = async (options = {}) => {
        const [sessions, changes, todos, ids] = await Promise.all([
          scoped.listSessions({ ...options, limit: options.sessionLimit || 10 }),
          scoped.listChanges({ ...options, limit: options.changeLimit || 60 }),
          scoped.listTodos(options),
          sessionIds(options),
        ]);
        const facts = await eyes.assistantFacts({ ...options, root: project.path, sessions, changes, todos });
        return { ...facts, project, sessions: (facts.sessions || []).filter((session) => ids.has(session.id)) };
      };
      return scoped;
    },
  };
}

module.exports = { createProjects, projectFromPath, containsPath, pathKey };
