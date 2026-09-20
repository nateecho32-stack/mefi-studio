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

function pathKey(value) {
  const resolved = path.resolve(String(value));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function containsPath(root, value) {
  if (!value) return false;
  const relative = path.relative(pathKey(root), pathKey(value));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

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
      let knownSessions = null;
      let sessionsAt = 0;
      const sessions = (options = {}) => {
        if (!knownSessions || Date.now() - sessionsAt > 250) {
          knownSessions = eyes.listSessions({ ...options, limit: Math.max(400, options.limit || 40) }).filter((session) => containsPath(project.path, session.directory));
          sessionsAt = Date.now();
        }
        return knownSessions;
      };
      if (eyes.readPins) scoped.readPins = (file) => eyes.readPins(dataPath(file, project));
      if (eyes.writePins) scoped.writePins = async (file, value) => {
        const target = dataPath(file, project);
        await mkdir(path.dirname(target), { recursive: true });
        return eyes.writePins(target, value);
      };
      if (eyes.listSessions) scoped.listSessions = (options = {}) => sessions(options).slice(0, options.limit || 40);
      if (eyes.findRunSession) scoped.findRunSession = (options = {}) => {
        const session = eyes.findRunSession(options);
        return session && containsPath(project.path, session.directory) ? session : null;
      };
      if (eyes.listSessionChecks) scoped.listSessionChecks = (options = {}) => {
        // Check one exact session directly rather than relying on the recent
        // 400-session UI cache: verification may resume after a long outage.
        try {
          const row = eyes.openDb(options.dbPath).prepare("select directory from session where id = ?").get(options.sessionId ?? "");
          if (!row || !containsPath(project.path, row.directory)) return { available: false, checks: [], truncated: false, error: "Session check evidence is unavailable for this project" };
          return eyes.listSessionChecks(options);
        } catch {
          return { available: false, checks: [], truncated: false, error: "Session check evidence is unavailable for this project" };
        }
      };
      for (const method of ["listTodos", "listChanges", "listChatTexts", "activitySince"]) {
        if (typeof eyes[method] !== "function") continue;
        scoped[method] = (options = {}) => {
          const ids = new Set(sessions(options).map((session) => session.id));
          return eyes[method](options).filter((row) => ids.has(row.sessionId) && (!row.file || !path.isAbsolute(row.file) || containsPath(project.path, row.file)));
        };
      }
      if (eyes.assistantFacts) scoped.assistantFacts = (options = {}) => {
        const ids = new Set(sessions(options).map((session) => session.id));
        const facts = eyes.assistantFacts({
          ...options, root: project.path,
          sessions: scoped.listSessions({ ...options, limit: options.sessionLimit || 10 }),
          changes: scoped.listChanges({ ...options, limit: options.changeLimit || 60 }),
          todos: scoped.listTodos(options),
        });
        return { ...facts, project, sessions: (facts.sessions || []).filter((session) => ids.has(session.id)) };
      };
      return scoped;
    },
  };
}

module.exports = { createProjects, projectFromPath, containsPath };
