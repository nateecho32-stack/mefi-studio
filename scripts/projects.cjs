// Local project identity and storage boundaries. A captured project never changes
// when the selected project changes, including work that resumes after an await.
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

function projectFromPath(value, { name, legacy = false } = {}) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw new TypeError("Choose an absolute project folder.");
  const root = path.resolve(value);
  return Object.freeze({
    id: `project_${crypto.createHash("sha256").update(pathKey(root)).digest("hex").slice(0, 16)}`,
    name: String(name || path.basename(root) || root).slice(0, 100),
    path: root,
    ...(legacy ? { legacy: true } : {}),
  });
}

function createProjects({ defaultRoot, studioRoot, saved = {}, preferredRoot = null, isDirectory = () => true }) {
  const context = new AsyncLocalStorage();
  const legacyRoot = typeof saved?.legacyPath === "string" && path.isAbsolute(saved.legacyPath) ? saved.legacyPath : defaultRoot;
  const legacy = projectFromPath(legacyRoot, { legacy: true });
  const projects = new Map([[legacy.id, legacy]]);
  const fallback = projectFromPath(defaultRoot);
  if (!projects.has(fallback.id)) projects.set(fallback.id, fallback);
  for (const item of Array.isArray(saved?.items) ? saved.items : []) {
    try {
      const project = projectFromPath(item.path, { name: item.name });
      if (!projects.has(project.id)) projects.set(project.id, project);
    } catch {}
  }
  let active = projects.get(saved?.activeId);
  if (preferredRoot && path.isAbsolute(preferredRoot)) {
    const preferred = projectFromPath(preferredRoot);
    if (!projects.has(preferred.id)) projects.set(preferred.id, preferred);
    active = projects.get(preferred.id);
  }
  if (!active || !isDirectory(active.path)) active = projects.get(fallback.id);
  const current = () => context.getStore() || active;
  const list = () => ({ ok: true, projects: [...projects.values()], activeId: active.id, activeProject: active });
  const stamp = (row, project = current()) => row && typeof row === "object" ? { ...row, projectId: project.id, projectPath: project.path } : row;
  function dataPath(file, project = current()) {
    const dataRoot = path.join(studioRoot, "data");
    if (project.legacy || !containsPath(dataRoot, file)) return file;
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
    find: (id) => projects.get(id),
    saved: () => ({ activeId: active.id, legacyPath: legacy.path, items: [...projects.values()].map(({ id, name, path }) => ({ id, name, path })) }),
    add(value) {
      const project = projectFromPath(value);
      if (!isDirectory(project.path)) throw new Error("The selected project folder is unavailable.");
      if (!projects.has(project.id)) projects.set(project.id, project);
      return projects.get(project.id);
    },
    select(id) {
      const project = projects.get(id);
      if (!project) throw new Error("Choose a project from your project list.");
      if (!isDirectory(project.path)) throw new Error("That project folder is unavailable. Reconnect it before switching.");
      active = project;
      return project;
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
