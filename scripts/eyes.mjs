// A-Eyes data layer — reads the live OpenCode session store read-only.
//
// Sources:
//   ~/.local/share/opencode/opencode.db   sessions, todos, tool parts (edits/diffs)
//   ~/.local/share/opencode/log/opencode.log
//   <repo>/tools/logs                      PNG evidence + manifests
//
// Everything here is read-only; the DB is opened with { readOnly: true } so it
// is safe while an OpenCode session is writing.

import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, mkdirSync } from "node:fs";
import { open, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { containsPath } from "./path-scope.cjs";

export const OPENCODE_DIR = path.join(os.homedir(), ".local", "share", "opencode");
export const DEFAULT_DB = path.join(OPENCODE_DIR, "opencode.db");
export const DEFAULT_LOG = path.join(OPENCODE_DIR, "log", "opencode.log");

let cached = null;

export function openDb(dbPath = DEFAULT_DB) {
  if (cached && cached.path === dbPath) return cached.db;
  if (!existsSync(dbPath)) throw new Error(`OpenCode database not found at ${dbPath}`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  cached = { path: dbPath, db };
  return db;
}

// A machine that has never run OpenCode has no session store yet. Listing
// surfaces treat that as an empty store, so first-run Studio opens with an
// empty tree instead of gating startup on "store unavailable". Callers that
// must distinguish (check evidence, direct opens) still see openDb's throw for
// a store that exists but cannot be read.
function storePresent(dbPath) {
  return existsSync(dbPath);
}

// The part table has no index on time_created and its type lives inside the
// JSON data blob, so every "newest rows of type X" query is a full table
// scan that json_extracts each row. A long-lived OpenCode store is dominated
// by tool output: 17 GB across 115k rows was measured, and one such scan
// read gigabytes and blocked the main process for 10 s or more, which is what
// gated startup on "Your projects and work · Couldn't load". Parts are
// appended in creation order, so a scan bounded by rowid from the newest end
// reads only the recent tail; the window widens until the caller has enough
// rows (count) or the window reaches back past its time bound (covers).
const PART_WINDOW = 2000;
function scanRecentParts(db, query, enough) {
  const top = db.prepare("select max(rowid) top from part").get()?.top ?? 0;
  let size = PART_WINDOW;
  for (;;) {
    const lower = Math.max(0, top - size);
    const rows = query(lower);
    if (lower === 0 || enough(rows, lower)) return rows;
    size *= 4;
  }
}
// True once every row created after `since` lies inside the window (rowid >
// lower). Reads only row headers: time_created sits before the data blob.
function windowCovers(db, lower, since) {
  if (lower === 0) return true;
  const oldest = db.prepare("select min(time_created) t from part where rowid > ?").get(lower)?.t;
  return oldest !== null && oldest !== undefined && oldest <= since;
}

function parseModel(raw) {
  try {
    const parsed = JSON.parse(raw);
    return { id: parsed.id ?? null, provider: parsed.providerID ?? null, variant: parsed.variant ?? null };
  } catch {
    return { id: raw ?? null, provider: null, variant: null };
  }
}

function countDiff(diff) {
  let additions = 0;
  let deletions = 0;
  for (const line of String(diff).split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) additions += 1;
    else if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions };
}

function fileOf(input) {
  return input?.filePath ?? input?.file_path ?? null;
}

function toChange(part) {
  let data;
  try {
    data = JSON.parse(part.data);
  } catch {
    return null;
  }
  const sessionId = part.session_id;
  const time = part.time_created;
  if (data.type === "patch" && Array.isArray(data.files)) {
    return {
      id: part.id,
      sessionId,
      time,
      tool: "patch",
      file: data.files[0] ?? null,
      files: data.files,
      additions: 0,
      deletions: 0,
      diff: null,
      status: "completed",
      hash: data.hash ?? null,
    };
  }
  if (data.type !== "tool") return null;
  if (!["edit", "write"].includes(data.tool)) return null;
  const input = data.state?.input ?? {};
  const diff = data.state?.metadata?.diff ?? null;
  let additions = 0;
  let deletions = 0;
  if (diff) ({ additions, deletions } = countDiff(diff));
  else if (data.tool === "write" && typeof input.content === "string") {
    additions = input.content.split("\n").length;
  }
  return {
    id: part.id,
    sessionId,
    time,
    tool: data.tool,
    file: fileOf(input),
    files: fileOf(input) ? [fileOf(input)] : [],
    additions,
    deletions,
    diff,
    status: data.state?.status ?? "completed",
    hash: null,
  };
}

const SESSION_COLUMNS = `id, parent_id, title, agent, model, directory, cost,
              tokens_input, tokens_output, tokens_cache_read,
              summary_files, summary_additions, summary_deletions,
              time_created, time_updated`;

// `root` scopes the listing to sessions whose directory lies inside that
// folder (scripts/path-scope.cjs semantics), applied before the per-session
// final-part lookup below. The project facade used to list the 400 newest
// sessions of every project and filter afterwards, which paid that lookup
// 400 times per read; scoping here pays it `limit` times.
export function listSessions({ dbPath = DEFAULT_DB, limit = 40, root = null } = {}) {
  if (!storePresent(dbPath)) return [];
  const db = openDb(dbPath);
  const rows = root
    ? db
        .prepare(`select ${SESSION_COLUMNS} from session order by time_updated desc`)
        .all()
        .filter((row) => containsPath(root, row.directory))
        .slice(0, limit)
    : db.prepare(`select ${SESSION_COLUMNS} from session order by time_updated desc limit ?`).all(limit);
  // Whether a session ended on purpose: its final part is a step-finish with
  // reason "stop". A silent tail, a mid-turn "tool-calls" finish or an abort
  // means the run left work hanging. Reviewers must never read a finished
  // session as stalled just because it kept no todo list.
  const finished = new Set();
  // Locate the final part by its cheap columns first; parsing data for every
  // part of a long session would read all of its tool output.
  const lastPart = db.prepare(
    `select json_extract(data,'$.type') type, json_extract(data,'$.reason') reason
     from part where rowid = (
       select rowid from part where session_id = ? order by time_created desc, id desc limit 1)`
  );
  for (const row of rows) {
    try {
      const last = lastPart.get(row.id);
      if (last?.type === "step-finish" && last.reason === "stop") finished.add(row.id);
    } catch {}
  }
  return rows.map((row) => ({
    id: row.id,
    parentId: row.parent_id,
    title: row.title,
    agent: row.agent,
    model: parseModel(row.model),
    directory: row.directory,
    cost: row.cost,
    finished: finished.has(row.id),
    tokens: {
      input: row.tokens_input,
      output: row.tokens_output,
      cacheRead: row.tokens_cache_read,
    },
    summary: {
      files: row.summary_files ?? 0,
      additions: row.summary_additions ?? 0,
      deletions: row.summary_deletions ?? 0,
    },
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }));
}

// Every session id under a folder, without the per-session
// final-part lookup listSessions pays: the project facade scopes todo, change
// and chat reads by this set. Reads only the session table (846 rows measured
// against the 121k-row part table).
export function listSessionIds({ dbPath = DEFAULT_DB, root = null } = {}) {
  if (!storePresent(dbPath)) return [];
  const db = openDb(dbPath);
  const rows = db.prepare("select id, directory from session").all();
  return rows.filter((row) => !root || containsPath(root, row.directory)).map((row) => row.id);
}

// The folder one session ran in, or null when the store or the session is
// missing. The facade's project check for verification evidence reads this
// instead of opening the store on the calling thread.
export function sessionDirectory({ dbPath = DEFAULT_DB, sessionId } = {}) {
  if (typeof sessionId !== "string" || !sessionId || !storePresent(dbPath)) return null;
  const row = openDb(dbPath).prepare("select directory from session where id = ?").get(sessionId);
  return typeof row?.directory === "string" ? row.directory : null;
}

// A dispatch identifies itself in its initial user prompt. Creation time is
// only a search bound: concurrent runs and manually opened sessions may start
// in either order, so their edits must never be attributed by timestamp alone.
export function findRunSession({ dbPath = DEFAULT_DB, runId, since = 0 } = {}) {
  if (!/^run_[a-zA-Z0-9_]+$/.test(String(runId ?? ""))) return null;
  if (!storePresent(dbPath)) return null;
  const db = openDb(dbPath);
  const rows = db.prepare(`
    select distinct s.id, s.directory, s.time_created
    from session s
    join part p on p.session_id = s.id
    join message m on m.id = p.message_id and m.session_id = s.id
    where s.parent_id is null and s.time_created >= ?
      and json_extract(m.data, '$.role') = 'user'
      and json_extract(p.data, '$.type') = 'text'
      and (instr(json_extract(p.data, '$.text'), ?) > 0
        or instr(json_extract(p.data, '$.text'), ?) > 0)
    limit 2
  `).all(Number(since) || 0, `This dispatch is run ${runId}.`, `This dispatch is run ${runId} for task `);
  // Ambiguous/copied dispatches stay unattributed rather than borrowing proof.
  if (rows.length !== 1) return null;
  return { id: rows[0].id, directory: rows[0].directory, timeCreated: rows[0].time_created };
}

export function listChanges({ dbPath = DEFAULT_DB, sessionId = null, limit = 300, since = null, until = null } = {}) {
  if (!storePresent(dbPath)) return [];
  const db = openDb(dbPath);
  const where = `json_extract(data,'$.type') in ('tool','patch')`;
  if (since !== null || until !== null) {
    // Verification requests a complete attempt window. Older callers omit it
    // and keep their existing timeline behavior below.
    if (!finiteTime(since) || !finiteTime(until) || until < since || !sessionId) return [];
    const rows = db.prepare(`select id, session_id, time_created, data from part
      where ${where} and session_id = ? and time_created >= ? and time_created <= ?
      order by time_created desc limit ?`).all(sessionId, since, until, limit);
    return rows.filter((row) => {
      let data;try { data = JSON.parse(row.data); } catch { return false; }
      if (data?.type === "patch") return true; // patch events are timestamped, completed writes
      const start = data?.state?.time?.start, end = data?.state?.time?.end;
      return finiteTime(start) && finiteTime(end) && start >= since && end >= start && end <= until;
    }).map(toChange).filter(Boolean);
  }
  const rows = sessionId
    ? db
        .prepare(
          `select id, session_id, time_created, data from part
           where ${where} and session_id = ? order by time_created desc limit ?`
        )
        .all(sessionId, limit)
    : scanRecentParts(db, (lower) => db
        .prepare(
          `select id, session_id, time_created, data from part
           where rowid > ? and ${where} order by time_created desc limit ?`
        )
        .all(lower, limit), (found) => found.length >= limit);
  return rows.map(toChange).filter(Boolean);
}

// Recorded process outcomes are evidence; an assistant saying it ran a check
// is not. This reader deliberately does not decide whether a command tests the
// task's acceptance criteria. The verifier makes that separate decision.
const CHECK_COMMAND_LIMIT = 4000;
const CHECK_OUTPUT_LIMIT = 2000;
const finiteTime = (value) => Number.isFinite(value) && value >= 0;
const checkWindow = ({ sessionId, since, until } = {}) => typeof sessionId === "string" && Boolean(sessionId.trim()) && finiteTime(since) && finiteTime(until) && until >= since;

export function sessionCheckEvidence(part, options = {}) {
  if (!checkWindow(options) || part?.session_id !== options.sessionId || !finiteTime(part?.time_created) || part.time_created < options.since || part.time_created > options.until) return null;
  let data;
  try { data = typeof part.data === "string" ? JSON.parse(part.data) : part.data; } catch { return null; }
  if (data?.type !== "tool" || data.tool !== "bash") return null;
  const state = data.state ?? {};
  const command = state.input?.command;
  if (typeof command !== "string" || !command.trim()) return null;
  const startedAt = finiteTime(state.time?.start) ? state.time.start : null;
  const finishedAt = finiteTime(state.time?.end) ? state.time.end : null;
  // Old sessions and a later reuse of the same session cannot lend this
  // attempt a passing check. Missing timing never becomes a positive result.
  if (startedAt !== null && (startedAt < options.since || startedAt > options.until)) return null;
  if (finishedAt !== null && (finishedAt < options.since || finishedAt > options.until)) return null;
  const validTiming = startedAt !== null && finishedAt !== null && finishedAt >= startedAt;
  const exitCode = Number.isSafeInteger(state.metadata?.exit) ? state.metadata.exit : null;
  const status = ["completed", "error", "running", "pending"].includes(state.status) ? state.status : "unknown";
  const output = typeof state.output === "string" ? state.output : typeof state.metadata?.output === "string" ? state.metadata.output : "";
  return {
    id: typeof part.id === "string" ? part.id : null,
    sessionId: part.session_id, tool: "bash", command: command.slice(0, CHECK_COMMAND_LIMIT),
    commandTruncated: command.length > CHECK_COMMAND_LIMIT,
    status, exitCode, startedAt, finishedAt,
    outputExcerpt: output.slice(-CHECK_OUTPUT_LIMIT),
    outputTruncated: state.metadata?.truncated === true || output.length > CHECK_OUTPUT_LIMIT,
    passed: status === "error" ? false : status === "completed" && validTiming && exitCode !== null ? exitCode === 0 : null,
  };
}

export function listSessionChecks({ dbPath = DEFAULT_DB, sessionId, since, until, limit = 200 } = {}) {
  const unavailable = () => ({ available: false, checks: [], truncated: false, error: "Session check evidence is unavailable" });
  if (!checkWindow({ sessionId, since, until })) return unavailable();
  const cap = Number.isFinite(limit) ? Math.min(1000, Math.max(1, Math.floor(limit))) : 200;
  try {
    const db = openDb(dbPath);
    // Clip large command output inside SQLite, before it crosses into the
    // main process. Keep one extra character/row to report truncation honestly.
    const rows = db.prepare(`
      with scoped as (
        select id, session_id, time_created,
          case when json_valid(data) then data else '{}' end payload
        from part where session_id = ? and time_created >= ? and time_created <= ?
      )
      select id, session_id, time_created, json_object(
        'type', 'tool', 'tool', 'bash',
        'state', json_object(
          'status', json_extract(payload, '$.state.status'),
          'input', json_object('command', substr(json_extract(payload, '$.state.input.command'), 1, ?)),
          'metadata', json_object(
            'exit', case when json_type(payload, '$.state.metadata.exit') in ('integer', 'real') then json_extract(payload, '$.state.metadata.exit') else null end,
            'truncated', json(case when json_type(payload, '$.state.metadata.truncated') = 'true' then 'true' else 'false' end)),
          'time', json_object(
            'start', case when json_type(payload, '$.state.time.start') in ('integer', 'real') then json_extract(payload, '$.state.time.start') else null end,
            'end', case when json_type(payload, '$.state.time.end') in ('integer', 'real') then json_extract(payload, '$.state.time.end') else null end),
          'output', substr(coalesce(json_extract(payload, '$.state.output'), json_extract(payload, '$.state.metadata.output'), ''), -?)
        )
      ) data
      from scoped where json_extract(payload, '$.type') = 'tool' and json_extract(payload, '$.tool') = 'bash' and json_type(payload, '$.state.input.command') = 'text'
      order by time_created desc, id desc limit ?
    `).all(sessionId, since, until, CHECK_COMMAND_LIMIT + 1, CHECK_OUTPUT_LIMIT + 1, cap + 1);
    const checks = rows.slice(0, cap).map((part) => sessionCheckEvidence(part, { sessionId, since, until })).filter(Boolean);
    return { available: true, checks, truncated: rows.length > cap };
  } catch {
    // Missing/locked/corrupt stores are unknown evidence, distinct from an
    // available store that contains no checks. Do not expose DB paths/output.
    return unavailable();
  }
}

export function listTodos({ dbPath = DEFAULT_DB, sessionId = null } = {}) {
  if (!storePresent(dbPath)) return [];
  const db = openDb(dbPath);
  const rows = sessionId
    ? db.prepare("select * from todo where session_id = ? order by position asc").all(sessionId)
    : db.prepare("select * from todo order by time_updated desc limit 400").all();
  return rows.map((row) => ({
    sessionId: row.session_id,
    content: row.content,
    status: row.status,
    priority: row.priority,
    position: row.position,
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  }));
}

// New tool activity since a timestamp; used by the 1.5s poll for the tree pulses.
export function activitySince({ dbPath = DEFAULT_DB, since = 0, limit = 60 } = {}) {
  if (!storePresent(dbPath)) return [];
  const db = openDb(dbPath);
  const rows = scanRecentParts(db, (lower) => db
    .prepare(
      `select id, session_id, time_created, json_extract(data,'$.tool') tool,
              json_extract(data,'$.state.input.filePath') file,
              substr(data, 1, 200) head
       from part
       where rowid > ? and time_created > ? and json_extract(data,'$.type') = 'tool'
       order by time_created asc limit ?`
    )
    .all(lower, since, limit), (_found, lower) => windowCovers(db, lower, since));
  return rows.map((row) => ({
    id: row.id,
    sessionId: row.session_id,
    time: row.time_created,
    tool: row.tool,
    file: row.file,
  }));
}

// Newest PNG evidence under <root>/tools/logs (and optional extra roots).
export async function listPngs({ roots = [], limit = 12 } = {}) {
  const found = [];
  async function walk(dir, depth) {
    if (depth > 2) return;
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else if (/\.png$/i.test(entry.name)) {
        try {
          const info = await stat(full);
          found.push({ path: full, name: entry.name, size: info.size, mtime: info.mtimeMs });
        } catch {}
      }
    }
  }
  for (const root of roots) await walk(root, 0);
  // Our own screenshot tour is technically the newest file in tools/logs, but
  // real evidence (game renders, patch-note frames) is more useful first.
  return found
    .sort((a, b) => {
      const capture = (png) => (/mefi_studio_captures/.test(png.path) ? 1 : 0);
      const delta = capture(a) - capture(b);
      return delta !== 0 ? delta : b.mtime - a.mtime;
    })
    .slice(0, limit);
}

export async function tailLog({ logPath = DEFAULT_LOG, lines = 220 } = {}) {
  let handle;
  try {
    handle = await open(logPath, "r");
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return "";
    throw error;
  }
  try {
    // Stat and read the same descriptor so rotation cannot mix two files.
    // Bound both allocation and I/O even when the live log is very large.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const info = await handle.stat();
      const length = Math.min(info.size, 512 * 1024);
      const start = info.size - length;
      const buffer = Buffer.allocUnsafe(length);
      let used = 0;
      while (used < length) {
        const { bytesRead } = await handle.read(buffer, used, length - used, start + used);
        if (!bytesRead) break;
        used += bytesRead;
      }
      // A log truncated below the old offset can be read again once. No
      // bytes were consumed, so the total read budget remains 512 KiB.
      if (length && !used && attempt === 0) continue;
      let offset = 0;
      // The clipped prefix may begin inside a UTF-8 character.
      if (start) while (offset < used && (buffer[offset] & 0xc0) === 0x80) offset += 1;
      const text = buffer.subarray(offset, used).toString("utf8");
      return text.split("\n").slice(-lines).join("\n");
    }
  } finally {
    await handle.close();
  }
}

export async function readPins(pinsPath) {
  try {
    return JSON.parse(await readFile(pinsPath, "utf8"));
  } catch {
    return {};
  }
}

export async function writePins(pinsPath, pins) {
  // Atomic like writeJson: pins ride the same torn-write hazard as the stores.
  return writeJson(pinsPath, pins);
}

// Parsed-row cache for the board views (eyes-tasks.json and its siblings).
// The task board is dominated by contextHistory: 7.9 MB of the live file,
// 1,150 saved revisions, and the app parsed it on the main thread five or
// more times per mutation cycle (the gateway read, the renderer's task-list
// and backlog reads behind the broadcast, the queue-depth refresh) at 22 ms
// a parse plus 8 ms of UTF-8 decode. A caller that opts in (the project
// facade does, for the three board files) gets the cached parse back while
// the file's bytes are the ones this process last read or wrote: a memcmp
// of the file (3 ms), never a timestamp heuristic, so a rewrite by another
// process is always seen. Rows handed out are fresh copies of each row's
// body; only `contextHistory` is shared by reference, because it is
// append-only and never edited in place (the board gateway already shares
// it between its read snapshot and working copy for the same reason). The
// cache keeps a private copy of the rows, so a caller editing a row it was
// given cannot poison a later read.
const cachedRows = new Map();
const rowCacheKey = (pathname) => path.resolve(String(pathname));
function cloneRow(row) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return structuredClone(row);
  const { contextHistory, ...body } = row;
  return contextHistory === undefined ? structuredClone(body) : { ...structuredClone(body), contextHistory };
}
function rememberRows(pathname, bytes, rows, layout = null) {
  const key = rowCacheKey(pathname);
  if (!Array.isArray(rows)) {
    cachedRows.delete(key);
    return;
  }
  try {
    cachedRows.set(key, { bytes, rows: rows.map(cloneRow), marks: layout?.marks ?? null, spans: layout?.spans ?? null });
  } catch {
    cachedRows.delete(key); // a row the structured clone refuses is simply not cached
  }
}

// Serializing the board for a write is JSON.stringify(rows, null, 2), whose
// text is one indented row after another. A row whose compact JSON matches a
// cached row's (with the history slot marked, so its position counts) and
// whose history is the same object serializes to the same text, so its bytes
// are reused from the last written buffer instead of being pretty-printed
// again: a checkpoint write re-prints one row, not 7.9 MB. The result is
// byte-identical to the plain stringify; tests pin that.
const ROW_INDENT = "  ";
const rowMark = (row) => (!row || typeof row !== "object" || Array.isArray(row) || row.contextHistory === undefined ? JSON.stringify(row) ?? "null" : JSON.stringify({ ...row, contextHistory: 0 }));
const prettyRow = (row) => `${ROW_INDENT}${(JSON.stringify(row, null, 2) ?? "null").split("\n").join(`\n${ROW_INDENT}`)}`;
function serializeRows(rows, known) {
  if (!rows.length) return { bytes: Buffer.from("[]", "utf8"), marks: [], spans: [] };
  const reusable = new Map();
  if (known?.marks && known.spans) for (let index = 0; index < known.marks.length; index += 1) reusable.set(known.marks[index], index);
  const parts = [Buffer.from("[\n", "utf8")];
  const separator = Buffer.from(",\n", "utf8");
  const marks = new Array(rows.length);
  const spans = new Array(rows.length);
  let offset = 2;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const mark = rowMark(row);
    marks[index] = mark;
    const at = reusable.get(mark);
    const cached = at === undefined ? undefined : known.rows[at];
    const part = at !== undefined && (row === null ? cached === null : row?.contextHistory === cached?.contextHistory)
      ? known.bytes.subarray(known.spans[at][0], known.spans[at][1])
      : Buffer.from(prettyRow(row), "utf8");
    if (index) {
      parts.push(separator);
      offset += 2;
    }
    parts.push(part);
    spans[index] = [offset, offset + part.length];
    offset += part.length;
  }
  parts.push(Buffer.from("\n]", "utf8"));
  return { bytes: Buffer.concat(parts), marks, spans };
}

export async function readJson(pathname, fallback, { rowCache: shareRows = false } = {}) {
  // Board stores route through the SQLite authority while it is enabled AND
  // healthy (enableBoardStore). A store that degraded — open failure, or the
  // stale-fork guard below — hands the read back to the JSON view: in file
  // mode the file is the authority again, never an empty fallback.
  const boardKind = boardKindFor(pathname);
  if (boardKind && boardEnabled()) {
    const stored = await boardRead(boardKind, null);
    if (Array.isArray(stored)) return stored;
    // the store failed or degraded mid-read — fall through to the view file
  }
  if (!shareRows) {
    try {
      return JSON.parse(await readFile(pathname, "utf8"));
    } catch {
      return fallback;
    }
  }
  let bytes;
  try {
    bytes = await readFile(pathname);
  } catch {
    return fallback;
  }
  const known = cachedRows.get(rowCacheKey(pathname));
  if (known && known.bytes.equals(bytes)) return known.rows.map(cloneRow);
  let value;
  try {
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    cachedRows.delete(rowCacheKey(pathname));
    return fallback;
  }
  rememberRows(pathname, bytes, value);
  return value;
}

// Quarantine cleanup: the fix pass sets a store that no longer parses aside
// as `<name>.broken-<ts>.json`, and those set-asides used to pile up in
// data/ forever. The moment an atomic write succeeds the target holds a
// fresh, parseable document, so every `.broken-*` sibling of it is stale —
// sweep it as part of the write. This is the only place that touches
// `.broken-` files, and it only ever deletes them.
//
// A writer killed between writeFile and rename (crash, kill -9) can never run
// its own cleanup, so its `.tmp-<pid>-<rand>` sibling is orphaned forever —
// seen live as machine-status.json.tmp-9148-eyny9w next to the data store.
// Sweep those too, but only once they are older than a minute: a live
// concurrent writer's tmp is always younger, and on Windows the rm of a file
// another process still holds fails anyway, so the age guard just keeps the
// sweep from disturbing a healthy racing writer.
const STALE_TMP_AGE_MS = 60_000;

async function sweepBrokenSiblings(pathname) {
  const dir = path.dirname(pathname);
  const fileName = path.basename(pathname);
  const brokenStem = `${path.basename(fileName, path.extname(fileName))}.broken-`;
  const tmpStem = `${fileName}.tmp-`;
  const cutoff = Date.now() - STALE_TMP_AGE_MS;
  let entries;
  try {
    entries = await readdir(dir);
  } catch {
    return;
  }
  const stale = [];
  for (const name of entries) {
    if (name.startsWith(brokenStem)) {
      stale.push(name);
      continue;
    }
    if (!name.startsWith(tmpStem)) continue;
    let stats;
    try {
      stats = await stat(path.join(dir, name));
    } catch {
      continue;
    }
    if (stats.mtimeMs <= cutoff) stale.push(name);
  }
  await Promise.all(
    stale.map((name) => rm(path.join(dir, name), { force: true }).catch(() => {}))
  );
}

export async function writeJson(pathname, value, { rowCache: shareRows = false } = {}) {
  const boardKind = boardKindFor(pathname);
  if (boardKind) return boardWrite(boardKind, value);
  const layout = shareRows && Array.isArray(value) ? serializeRows(value, cachedRows.get(rowCacheKey(pathname))) : null;
  const payload = layout ? layout.bytes : Buffer.from(JSON.stringify(value, null, 2), "utf8");
  // Write to a sibling temp file and rename over the target: a reader that
  // loaded the file mid-write (or a crash mid-write) used to see a torn JSON
  // document and silently reset the whole store to its fallback. The rename
  // is atomic on the same volume; if the platform refuses it, fall back to a
  // direct write rather than fail the caller. Either way the write ends with
  // a known-good target and no stale `.broken-*` sibling left behind.
  const tmp = `${pathname}.tmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    await writeFile(tmp, payload);
    try {
      await rename(tmp, pathname);
    } catch {
      await writeFile(pathname, payload);
    }
    // The bytes on disk are known exactly here. A board writer keeps the rows
    // it wrote for the reads that follow; any other write drops the entry so
    // the next read of that path parses fresh.
    if (shareRows) rememberRows(pathname, payload, value, layout);
    else cachedRows.delete(rowCacheKey(pathname));
    await sweepBrokenSiblings(pathname);
    return { ok: true };
  } finally {
    await rm(tmp, { force: true }).catch(() => {});
  }
}

// Absolute-path containment for root scoping. Normalizes separators so DB
// rows with either slash style match, and compares case-insensitively on
// Windows where drive paths differ in case freely.
function withinRoot(file, root) {
  if (!root) return true;
  const norm = (value) => {
    let out = `${String(value).replace(/[\\/]+/g, path.sep)}`.replace(/[\\/]+$/, "");
    return (process.platform === "win32" ? out.toLowerCase() : out) + path.sep;
  };
  return norm(file).startsWith(norm(root));
}

function fileKey(file) {
  return String(file ?? "")
    .replace(/[\\/]+/g, "/")
    .replace(/\/+$/, "")
    .toLowerCase();
}

function samePath(a, b) {
  const left = fileKey(a);
  const right = fileKey(b);
  if (!left || !right) return false;
  if (left === right) return true;
  return left.endsWith(`/${right}`) || right.endsWith(`/${left}`);
}

function joinRoot(root, rel) {
  const name = String(rel ?? "").replace(/[\\/]+/g, "/");
  if (!root) return name;
  return path.join(root, name).replace(/\\/g, "/");
}

function uniqueIds(ids) {
  const seen = new Set();
  const out = [];
  for (const id of ids ?? []) {
    const key = String(id ?? "");
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

// Two sessions are a live collision only while their edits to the file
// actually overlapped in time. A session that last touched the file long
// before another picked it up is a stale hand-off, not a conflict.
function temporallyOverlappingSessions(sessions, overlapMs) {
  const windows = [...sessions.entries()];
  const overlapping = new Set();
  for (let i = 0; i < windows.length; i += 1) {
    for (let j = i + 1; j < windows.length; j += 1) {
      const [, a] = windows[i];
      const [, b] = windows[j];
      const gap = Math.max(a.first - b.last, b.first - a.last);
      if (gap <= overlapMs) {
        overlapping.add(windows[i][0]);
        overlapping.add(windows[j][0]);
      }
    }
  }
  return overlapping;
}

// Files touched by more than one live session inside the window — the "collateral"
// signal both for the UI (always) and for the assistant's facts (when keyed).
// A collision requires (a) both sessions' edits to overlap in time and (b) the
// file to sit under `root` when one is given. Collisions from the same session
// set are grouped into one entry: the same two sessions grinding on one feature
// usually touch several files together, and one grouped alert beats a
// duplicate alert per file.
//
// Each group also carries live-coordination data read from the same store:
//   owner     — the session with the most edits overall (tie: most recent
//               edit); the one whose work the others should rebase onto.
//               Activity does not steal ownership — an idle owner with more
//               history stays the owner until a handoff is confirmed.
//   ownership — per-file owners, because a group can split a feature
//   active    — a session is active while its newest edit is within
//               ACTIVE_EDIT_MS; a group with no active side is history
//   handoff   — the owner is explicitly idle. Confirm before further edits;
//               do not treat a live peer as the new owner automatically.
const ACTIVE_EDIT_MS = 10 * 60 * 1000;

export function pickOwner(entries) {
  return (
    [...entries].sort(
      (a, b) =>
        b.edits - a.edits ||
        b.lastEdit - a.lastEdit ||
        String(a.sessionId).localeCompare(String(b.sessionId))
    )[0]?.sessionId ?? null
  );
}

function sessionIdOf(entry) {
  if (typeof entry === "string" && entry) return entry;
  return entry?.sessionId ?? null;
}

export function ownerIsInactive(collision) {
  const owner = collision?.owner;
  if (!owner || !Array.isArray(collision?.sessions)) return false;
  const row = collision.sessions.find((entry) => sessionIdOf(entry) === owner);
  return Boolean(row && typeof row === "object" && row.active === false);
}

function editWindowsByFile({ dbPath = DEFAULT_DB, since, root = null } = {}) {
  if (!storePresent(dbPath)) return new Map();
  const db = openDb(dbPath);
  const rows = scanRecentParts(db, (lower) => db
    .prepare(
      `select session_id, json_extract(data,'$.state.input.filePath') file, time_created
       from part
       where rowid > ? and time_created > ?
         and json_extract(data,'$.type') = 'tool'
         and json_extract(data,'$.tool') in ('edit','write')
       order by time_created desc`
    )
    .all(lower, since), (_found, lower) => windowCovers(db, lower, since));
  const byFile = new Map();
  for (const row of rows) {
    if (!row.file || !withinRoot(row.file, root)) continue;
    if (!byFile.has(row.file)) byFile.set(row.file, new Map());
    const sessions = byFile.get(row.file);
    const window = sessions.get(row.session_id) ?? { first: row.time_created, last: row.time_created, edits: 0 };
    window.first = Math.min(window.first, row.time_created);
    window.last = Math.max(window.last, row.time_created);
    window.edits += 1;
    sessions.set(row.session_id, window);
  }
  return byFile;
}

export function collisions({ dbPath = DEFAULT_DB, windowMs = 60 * 60 * 1000, since, root = null, overlapMs = 10 * 60 * 1000, now = Date.now() } = {}) {
  const from = since == null ? now - windowMs : since;
  const byFile = editWindowsByFile({ dbPath, since: from, root });
  const groups = new Map();
  for (const [file, sessions] of byFile) {
    if (sessions.size < 2) continue;
    const overlapping = temporallyOverlappingSessions(sessions, overlapMs);
    if (overlapping.size < 2) continue;
    const included = [...sessions.entries()]
      .filter(([sessionId]) => overlapping.has(sessionId))
      .map(([sessionId, window]) => ({ sessionId, edits: window.edits, first: window.first, last: window.last }));
    const key = included.map((entry) => entry.sessionId).sort().join("|");
    if (!groups.has(key)) groups.set(key, { bySession: new Map(), lastEdit: new Map(), firstEdit: new Map(), fileEntries: [], fileSessions: new Map() });
    const group = groups.get(key);
    for (const { sessionId, edits, first, last } of included) {
      group.bySession.set(sessionId, (group.bySession.get(sessionId) ?? 0) + edits);
      group.lastEdit.set(sessionId, Math.max(group.lastEdit.get(sessionId) ?? 0, last));
      group.firstEdit.set(sessionId, Math.min(group.firstEdit.get(sessionId) ?? first, first));
    }
    group.fileEntries.push({ file, last: Math.max(...included.map((entry) => entry.last)) });
    group.fileSessions.set(file, included.map(({ sessionId, edits, first, last }) => ({ sessionId, edits, firstEdit: first, lastEdit: last })));
  }
  const result = [];
  for (const group of groups.values()) {
    group.fileEntries.sort((a, b) => b.last - a.last);
    const files = group.fileEntries.map((entry) => entry.file);
    const sessions = [...group.bySession.entries()].map(([sessionId, edits]) => ({
      sessionId,
      edits,
      firstEdit: group.firstEdit.get(sessionId) ?? 0,
      lastEdit: group.lastEdit.get(sessionId) ?? 0,
      active: now - (group.lastEdit.get(sessionId) ?? 0) <= ACTIVE_EDIT_MS,
      files: group.fileEntries
        .map((entry) => entry.file)
        .filter((file) => (group.fileSessions.get(file) ?? []).some((row) => row.sessionId === sessionId)),
    }));
    const owner = pickOwner(sessions);
    // The group's overlap window — the span every session was editing
    // inside. `first` past `last` means the sessions never co-edited (a
    // gap-tolerated handoff); the renderer then shows each session's own
    // range instead of claiming a shared window that never existed.
    const overlap = {
      first: Math.max(...sessions.map((entry) => entry.firstEdit)),
      last: Math.min(...sessions.map((entry) => entry.lastEdit)),
    };
    result.push({
      file: files[0],
      files,
      owner,
      ownership: files.map((file) => ({ file, owner: pickOwner(group.fileSessions.get(file) ?? []) })),
      sessions,
      overlap,
      edits: sessions.reduce((sum, entry) => sum + entry.edits, 0),
      active: sessions.some((entry) => entry.active),
      handoff: ownerIsInactive({ owner, sessions }),
    });
  }
  return result.sort((a, b) => b.sessions.length - a.sessions.length || b.edits - a.edits || b.files.length - a.files.length);
}

function sessionSetKey(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean).map(String))].sort().join("|");
}

function sameSessionSet(a, b) {
  const left = sessionSetKey(a);
  return Boolean(left) && left === sessionSetKey(b);
}

function requestFiles(request) {
  const files = [];
  if (typeof request?.file === "string" && request.file) files.push(request.file);
  if (Array.isArray(request?.files)) files.push(...request.files.filter((file) => typeof file === "string" && file));
  return files;
}

function sessionEditLabel(entry) {
  const id = entry?.sessionId ?? entry;
  const edits = entry?.edits != null ? ` x${entry.edits}` : "";
  const names = (entry?.files ?? []).map((file) => String(file).split(/[\\/]/).pop()).filter(Boolean);
  const window = windowLabel(entry);
  return `${id}${edits}${names.length ? ` on ${names.join(", ")}` : ""}${window ? ` (${window})` : ""}`;
}

// Local wall clock as HH:MM — the same shape the explorer renderer shows for
// collision rows, so dispatched fix sessions and the UI agree on the range.
function clock(time) {
  if (!Number.isFinite(time)) return "";
  const date = new Date(time);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

// A session's edit window inside the collision, e.g. "14:02–14:38".
function windowLabel(entry) {
  const first = clock(entry?.firstEdit);
  const last = clock(entry?.lastEdit);
  return first && last ? `${first}–${last}` : "";
}

// Validate a collision's overlap window before a request input may cite it:
// both ends must be finite numbers and first must not pass last. A
// zero-length window (first === last) is a real single-instant clash and
// stays; an inverted window is a gap-tolerated handoff, and a corrupt one
// (missing, non-numeric, NaN) must not leak "NaN–NaN" into a prompt — both
// normalize to null so the caller falls back to the sessions' edit span.
export function overlapRangeOf(collision) {
  const overlap = collision?.overlap;
  if (!overlap || typeof overlap !== "object") return null;
  const { first, last } = overlap;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first > last) return null;
  return { first, last };
}

// Local action layer: turn findings into inbox requests. No API key needed.
// One request per collision group: the same session pair on several files is
// one ownership conflict, so it queues one fix, not one per file. A shared
// session on two different partners is two groups and two requests.
export function requestsFromCollisions(collisions, existing = []) {
  return collisions
    .filter((collision) => {
      const files = collision.files ?? [collision.file];
      const sessionIds = collision.sessions.map((entry) => entry.sessionId);
      return !existing.some((request) => {
        if (request.source !== "collision") return false;
        const known = requestFiles(request);
        if (files.some((file) => known.includes(file))) return true;
        return sameSessionSet(requestSessions(request), sessionIds);
      });
    })
    .map((collision) => {
      const files = collision.files ?? [collision.file];
      const label = files.length > 1 ? `${files[0].split(/[\\/]/).pop()} +${files.length - 1} more` : files[0].split(/[\\/]/).pop();
      const owner = collision.owner ?? collision.sessions[0]?.sessionId ?? null;
      const others = collision.sessions.map((entry) => entry.sessionId).filter((id) => id !== owner);
      const ownership = (collision.ownership ?? [])
        .filter((row) => row && row.file)
        .map((row) => ({ file: row.file, owner: row.owner ?? null }));
      const perFile = ownership
        .filter((row) => row.owner && files.length > 1)
        .map((row) => `${row.file.split(/[\\/]/).pop()} -> ${row.owner}`)
        .join("; ");
      const splitOwners = [...new Set(ownership.map((row) => row.owner).filter(Boolean))];
      const collaborating = splitOwners.length > 1;
      const resolveBit = collaborating
        ? `These sessions are collaborating on one feature: each keep the files they own and adopt missing pieces on the rest instead of clobbering. `
        : `${others.join(", ") || "the other sessions"} must stop or rebase onto that work instead of pushing competing edits. Adopt ${owner}'s work and add missing pieces rather than clobbering it. `;
      const activeIds = collision.sessions.filter((entry) => entry.active === true).map((entry) => entry.sessionId);
      const handoff = ownerIsInactive({ ...collision, owner });
      const idleBit = "No session has touched it in the last 10 minutes — finish and merge rather than re-editing.";
      const liveBit = activeIds.length ? `Active on it right now: ${activeIds.join(", ")}.` : "";
      const activity = handoff
        ? `Owner ${owner} is marked inactive; confirm handoff before further edits.${liveBit ? ` ${liveBit}` : ` ${idleBit}`}`
        : liveBit || idleBit;
      // The clash's time range, mirroring the explorer's overlapRange: the
      // shared overlap window when the sessions genuinely co-edited, else the
      // earliest-to-latest span (a gap-tolerated handoff has an empty
      // intersection and must not be labelled a shared window). The range is
      // validated first — a corrupt window (missing, non-numeric, or
      // inverted) falls through to the edit-span path instead of a prompt
      // citing "NaN–NaN".
      const shared = overlapRangeOf(collision);
      const windows = collision.sessions.filter((entry) => Number.isFinite(entry.firstEdit) && Number.isFinite(entry.lastEdit));
      const range =
        shared ??
        (windows.length
          ? { first: Math.min(...windows.map((entry) => entry.firstEdit)), last: Math.max(...windows.map((entry) => entry.lastEdit)) }
          : null);
      const rangeBit = range
        ? shared
          ? ` Overlap window: ${clock(range.first)}–${clock(range.last)}.`
          : ` Edit span: ${clock(range.first)}–${clock(range.last)} — the sessions never actually co-edited; treat this as a handoff, not a live clash.`
        : "";
      return {
        title: `Resolve collision: ${label}`,
        prompt:
          `A-Eyes collision: ${files.length} file(s) were edited by ${collision.sessions.length} sessions ` +
          `(${collision.sessions.map(sessionEditLabel).join("; ")}): ${files.join(", ")}. ` +
          `Edit history assigns overall ownership to ${owner} (most edits, latest touch)` +
          (perFile ? ` — per file: ${perFile}` : "") +
          `.${rangeBit}` +
          ` ${resolveBit}` +
          `${activity} Check the recent diffs and verify every file still parses.`,
        file: files[0],
        files,
        sessions: collision.sessions.map((entry) => entry.sessionId),
        edits: collision.sessions.map((entry) => ({
          sessionId: entry.sessionId,
          edits: entry.edits ?? 0,
          files: entry.files ?? [],
        })),
        owner,
        ownership,
        overlap: shared ? { first: shared.first, last: shared.last } : null,
        collaborating,
        handoff,
        source: "collision",
        at: Date.now(),
      };
    });
}

// Who is editing each file right now — collisions are the multi-session
// subset; presence also lists a file with a single live editor so concurrent
// work can steer around it before a collision forms.
export function filePresence({ dbPath = DEFAULT_DB, windowMs = ACTIVE_EDIT_MS, since, root = null, now = Date.now() } = {}) {
  const from = since == null ? now - windowMs : since;
  const byFile = editWindowsByFile({ dbPath, since: from, root });
  const result = [];
  for (const [file, sessions] of byFile) {
    const editors = [...sessions.entries()]
      .map(([sessionId, window]) => ({
        sessionId,
        edits: window.edits,
        lastEdit: window.last,
        active: now - window.last <= ACTIVE_EDIT_MS,
      }))
      .filter((entry) => entry.active)
      .sort((a, b) => b.lastEdit - a.lastEdit || b.edits - a.edits || String(a.sessionId).localeCompare(String(b.sessionId)));
    if (!editors.length) continue;
    result.push({
      file,
      editors,
      owner: pickOwner(editors),
      colliding: editors.length > 1,
    });
  }
  return result.sort(
    (a, b) =>
      Number(b.colliding) - Number(a.colliding) ||
      b.editors.length - a.editors.length ||
      (b.editors[0]?.lastEdit ?? 0) - (a.editors[0]?.lastEdit ?? 0)
  );
}

// git status --porcelain=v1. Deleted paths are the opposite of this signal
// (HEAD still has them); keep modified/added/untracked so a feature that
// only exists in the working tree is not treated as already in HEAD.
export function parsePorcelain(text) {
  const rows = [];
  for (const raw of String(text ?? "").split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (line.length < 4 || line[2] !== " ") continue;
    const index = line[0];
    const worktree = line[1];
    let rest = line.slice(3);
    if (rest.startsWith('"') && rest.endsWith('"')) rest = rest.slice(1, -1).replace(/\\"/g, '"');
    let orig = null;
    let filePath = rest;
    const renamed = index === "R" || index === "C" || worktree === "R" || worktree === "C";
    const arrow = rest.indexOf(" -> ");
    if (renamed && arrow >= 0) {
      orig = rest.slice(0, arrow);
      filePath = rest.slice(arrow + 4);
    }
    const untracked = index === "?" && worktree === "?";
    const deleted = (index === "D" || worktree === "D") && !untracked;
    if (deleted) continue;
    const staged = index !== " " && index !== "?";
    const dirty = worktree !== " " || staged || untracked;
    if (!dirty) continue;
    rows.push({ path: filePath.replace(/\\/g, "/"), orig, index, worktree, untracked, staged });
  }
  return rows;
}

export function gitPorcelain({ root, run = spawnSync } = {}) {
  if (!root) return "";
  if (!existsSync(path.join(root, ".git"))) return "";
  try {
    const result = run("git", ["-C", root, "status", "--porcelain=v1"], {
      encoding: "utf8",
      timeout: 8000,
      windowsHide: true,
    });
    if (!result || result.status !== 0) return "";
    return String(result.stdout ?? "");
  } catch {
    return "";
  }
}

// Files a live session already edited that are still dirty vs HEAD. The
// warning is the feature (session title), not a dump of the whole dirty tree:
// agents otherwise treat committed HEAD as the source of truth and rewrite
// work that only exists uncommitted.
export function uncommittedOnly({ porcelain = "", sessions = [], changes = [], root = null } = {}) {
  const dirty = parsePorcelain(porcelain);
  if (!dirty.length) return [];
  const sessionFiles = [];
  for (const change of Array.isArray(changes) ? changes : []) {
    if (change?.file && change.sessionId) sessionFiles.push({ file: change.file, sessionId: change.sessionId });
  }
  for (const session of Array.isArray(sessions) ? sessions : []) {
    const id = session?.id ?? session?.sessionId;
    for (const file of session?.changed?.files ?? []) {
      if (file && id) sessionFiles.push({ file, sessionId: id });
    }
  }
  const titleOf = (id) => {
    const session = (Array.isArray(sessions) ? sessions : []).find((row) => (row?.id ?? row?.sessionId) === id);
    return session?.title || id;
  };
  const result = [];
  for (const row of dirty) {
    const file = joinRoot(root, row.path);
    const holders = uniqueIds(
      sessionFiles
        .filter((hit) => samePath(hit.file, file) || samePath(hit.file, row.path))
        .map((hit) => hit.sessionId)
    );
    if (!holders.length) continue;
    const titles = uniqueIds(holders.map(titleOf));
    const name = file.split("/").pop();
    const feature = titles.length ? titles.map((title) => `"${title}"`).join(", ") : name;
    const where = row.untracked
      ? "the file is untracked and not in committed HEAD"
      : "it exists only as uncommitted changes, not in committed HEAD";
    result.push({
      file,
      path: row.path,
      untracked: row.untracked === true,
      sessions: holders,
      titles,
      warning: `HEAD does not have ${feature} — ${where} (${name}). Do not assume the committed tree contains this work.`,
    });
  }
  return result.sort((a, b) => b.sessions.length - a.sessions.length || String(a.path).localeCompare(String(b.path)));
}

export function requestsFromUncommitted(rows = [], existing = []) {
  return rows
    .filter((row) => row?.file && row.warning)
    .filter(
      (row) =>
        !existing.some(
          (request) =>
            request.source === "uncommitted" && (request.file === row.file || (request.files ?? []).includes(row.file))
        )
    )
    .map((row) => ({
      title: `HEAD missing: ${String(row.file).split(/[\\/]/).pop()}`,
      prompt:
        `A-Eyes: ${row.warning} Treat the working tree as the source of truth for this feature. ` +
        `Do not re-implement it from committed HEAD, and do not assume HEAD already has it.`,
      file: row.file,
      files: [row.file],
      sessions: row.sessions ?? [],
      source: "uncommitted",
      at: Date.now(),
    }));
}

const ADOPT_STOP = new Set([
  "about", "after", "already", "another", "clobber", "could", "feature", "file",
  "files", "from", "have", "implement", "implementation", "into", "live", "missing",
  "other", "rather", "session", "sessions", "should", "their", "there", "these",
  "this", "that", "with", "work", "would",
]);

// When a live session's title/todos overlap the job, say so: the right move
// is to adopt that work and fill gaps, not to rewrite the same feature.
// File-level live editors belong to collaborate()/claimWork(); this only
// fires on a real title/todo hit so every job does not get a generic lecture
// plus an unrelated editor list.
export function adoptAdvice({ title = "", prompt = "", sessions = [] } = {}) {
  const text = `${title} ${prompt}`.toLowerCase();
  const needles = text.split(/[^a-z0-9]+/).filter((word) => word.length >= 5 && !ADOPT_STOP.has(word));
  if (!needles.length) return "";
  const overlapping = [];
  for (const session of sessions) {
    if (!session) continue;
    const hay = `${session.title ?? session.id ?? ""} ${[...(session.todos ?? [])].map((todo) => todo?.content ?? todo).join(" ")}`.toLowerCase();
    if (needles.some((word) => hay.includes(word))) overlapping.push(session);
  }
  if (!overlapping.length) return "";
  return (
    `Another live session already looks like it implemented this: ` +
    overlapping
      .slice(0, 3)
      .map((session) => `${session.id ?? session.sessionId} "${session.title ?? ""}"`)
      .join("; ") +
    `. Adopt their work and add missing pieces rather than clobbering it.`
  );
}

// Top-level function/class/binding names that appear more than once — the
// usual fingerprint of two parallel-executor patches landing in one file.
export function duplicateDeclarations(text) {
  const names = new Map();
  const lines = String(text ?? "").split(/\r?\n/);
  const rules = [
    /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\b/,
    /^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)\b/,
    /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=/,
  ];
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line || line[0] === " " || line[0] === "\t") continue;
    if (line.startsWith("//") || line.startsWith("/*") || line.startsWith("*")) continue;
    for (const rule of rules) {
      const match = line.match(rule);
      if (!match) continue;
      const name = match[1];
      const entry = names.get(name) ?? { name, lines: [] };
      entry.lines.push(i + 1);
      names.set(name, entry);
      break;
    }
  }
  return [...names.values()].filter((entry) => entry.lines.length > 1).sort((a, b) => a.lines[0] - b.lines[0]);
}

export async function scanDuplicateDeclarations(files = []) {
  const findings = [];
  for (const file of files) {
    if (!file || !/\.(?:js|mjs|cjs)$/i.test(String(file))) continue;
    let text;
    try {
      text = await readFile(file, "utf8");
    } catch {
      continue;
    }
    const duplicates = duplicateDeclarations(text);
    if (duplicates.length) findings.push({ file, duplicates });
  }
  return findings;
}

export function requestsFromDuplicates(findings = [], existing = []) {
  return findings
    .filter((finding) => finding?.file && Array.isArray(finding.duplicates) && finding.duplicates.length)
    .filter((finding) => !existing.some((request) => request.source === "duplicate" && request.file === finding.file))
    .map((finding) => {
      const names = finding.duplicates.map((row) => `${row.name} @${row.lines.join(",")}`).join("; ");
      return {
        title: `Duplicate declarations: ${String(finding.file).split(/[\\/]/).pop()}`,
        prompt:
          `Duplicate declaration corruption in ${finding.file}: ${names}. ` +
          `Parallel-executor merges have landed two copies of the same function/const. ` +
          `Keep the complete implementation, delete the duplicate, and verify the file still parses.`,
        file: finding.file,
        duplicates: finding.duplicates,
        source: "duplicate",
        at: Date.now(),
      };
    });
}

// Two alerts that name the same session(s) are the same root cause even when
// the model words the titles differently ("stale sessions" vs "stalled
// triage"). Deduping on title alone queued both and dispatched two build
// sessions at one stall, so overlap on sessions is the signal that matters.
function requestSessions(request) {
  const ids = request?.sessions ?? request?.sessionIds ?? [];
  return Array.isArray(ids) ? ids.filter(Boolean) : [];
}

function sessionsOverlap(a, b) {
  if (!a.length || !b.length) return false;
  const seen = new Set(a);
  return b.some((id) => seen.has(id));
}

const SOURCE_FILE_RE = /\b([a-zA-Z0-9._-]+\.(?:js|mjs|cjs|py|lua|css|html))\b/g;
const FIX_FAMILIES = [
  ["dup", /\b(duplicat\w*|overlap\w*|collid\w*|collision\w*|redundant|same subsystem|root[- ]causes?)\b/i],
  ["stale", /\b(stale|stalled|in[- ]progress)\b/i],
];

function problemText(item = {}) {
  return `${item.alertTitle ?? ""} ${item.title ?? ""} ${item.detail ?? ""} ${item.prompt ?? ""}`;
}

function problemFilesOf(item = {}) {
  if (Array.isArray(item.problemFiles) && item.problemFiles.length) {
    return [...new Set(item.problemFiles.map((file) => String(file).toLowerCase()))].sort();
  }
  return [...new Set([...String(problemText(item)).matchAll(SOURCE_FILE_RE)].map((match) => match[1].toLowerCase()))].sort();
}

function problemFamilyOf(item = {}) {
  if (item.problemFamily) return String(item.problemFamily);
  const text = problemText(item);
  for (const [name, rule] of FIX_FAMILIES) {
    if (rule.test(text)) return name;
  }
  return null;
}

// Coarse key for a briefing alert / fix request: the problem family
// (duplicate-session vs stale vs other) plus any source files the text names.
// Two "duplicate root-cause" alerts with disjoint session ids are still one
// job; two alerts that name the same file are one job even without a family.
export function alertProblem(item = {}) {
  return { family: problemFamilyOf(item), files: problemFilesOf(item) };
}

export function sameFixProblem(a, b) {
  const left = alertProblem(a);
  const right = alertProblem(b);
  if (left.files.some((file) => right.files.includes(file))) return true;
  if (!left.family || !right.family || left.family !== right.family) return false;
  if (!left.files.length || !right.files.length) return true;
  return left.files.every((file) => right.files.includes(file)) || right.files.every((file) => left.files.includes(file));
}

export function requestsFromBriefing(briefing, existing = []) {
  const requests = [];
  for (const alert of briefing?.alerts ?? []) {
    if (!alert?.title || (alert.severity ?? "info") === "info") continue;
    const sessionIds = Array.isArray(alert.sessionIds) ? alert.sessionIds.filter(Boolean) : [];
    const problem = alertProblem({ title: alert.title, detail: alert.detail, alertTitle: alert.title });
    const duplicates = (request) =>
      request.alertTitle === alert.title ||
      (request.source === "fix" && sessionsOverlap(requestSessions(request), sessionIds)) ||
      (request.source === "fix" && sameFixProblem(request, { ...alert, alertTitle: alert.title, problemFamily: problem.family, problemFiles: problem.files }));
    if (existing.some(duplicates)) continue;
    if (requests.some(duplicates)) continue;
    const request = {
      title: `Fix: ${alert.title}`,
      prompt:
        `A-Eyes ${alert.severity} alert: ${alert.title}. ${alert.detail ?? ""} ` +
        `Sessions: ${sessionIds.join(", ") || "unknown"}. ` +
        "Find the root cause, fix it, and run the relevant test set before reporting back.",
      alertTitle: alert.title,
      sessions: sessionIds,
      source: "fix",
      at: Date.now(),
    };
    if (problem.family) request.problemFamily = problem.family;
    if (problem.files.length) request.problemFiles = problem.files;
    requests.push(request);
  }
  return requests;
}



// Text parts from recent sessions: chat material for idea scanning and
// reference gathering. Bounded length to stay fast on a live DB.
//
// Cursor callers (the ideas scan) read OLDEST-FIRST after a (time_created,
// part id) keyset cursor with order: "asc". The old newest-first
// `time_created > ? limit 400` pass advanced the cursor to the newest fetched
// timestamp, so a backlog deeper than one page permanently skipped everything
// it never fetched (450 unseen rows: the oldest 50 vanished for good).
// Oldest-first + an id tiebreak on duplicate timestamps means every pass
// consumes exactly its page and the next pass continues precisely after it —
// material can be delayed, never lost. The length bounds are applied in SQL
// so rows the scan would drop anyway never sit between the cursor and the
// page. Windowed callers (overseer chatter, reference gathering) keep the
// legacy newest-first read with the default order: "desc".
export function listChatTexts({ dbPath = DEFAULT_DB, after = { at: 0, id: "" }, since = null, limit = 400, minLength = 40, maxLength = 400, order = "desc" } = {}) {
  if (!storePresent(dbPath)) return [];
  const db = openDb(dbPath);
  const seed = after && typeof after === "object" ? after : { at: Number(after) || 0, id: "" };
  const afterAt = Number.isFinite(Number(since ?? seed.at)) ? Number(since ?? seed.at) : 0;
  const afterId = String(seed.id ?? "");
  const direction = order === "asc" ? "asc" : "desc";
  // Newest-first reads stop once the page is full; a cursor walk (asc) must
  // reach back to the cursor so no older row can precede its page.
  const rows = scanRecentParts(db, (lower) => db
    .prepare(
      `select id, session_id, time_created, json_extract(data,'$.text') text
       from part
       where rowid > ? and json_extract(data,'$.type') = 'text'
         and (time_created > ? or (time_created = ? and (? = '' or id > ?)))
         and length(json_extract(data,'$.text')) between ? and ?
       order by time_created ${direction}, id ${direction}
       limit ?`
    )
    .all(lower, afterAt, afterAt, afterId, afterId, minLength, maxLength, limit),
  (found, lower) => (direction === "desc" && found.length >= limit) || windowCovers(db, lower, afterAt));
  return rows.map((row) => ({ id: row.id, sessionId: row.session_id, at: row.time_created, text: row.text }));
}

export function assistantFacts({ dbPath = DEFAULT_DB, sessionLimit = 10, changeLimit = 60, todoLimitPerSession = 12, root = null, now = Date.now(), porcelain = null, sessions: scopedSessions = null, changes: scopedChanges = null, todos: scopedTodos = null } = {}) {
  const sessions = scopedSessions ?? listSessions({ dbPath, limit: sessionLimit });
  const changes = scopedChanges ?? listChanges({ dbPath, limit: changeLimit });
  const todos = scopedTodos ?? listTodos({ dbPath });
  const dirtyText = porcelain != null ? porcelain : gitPorcelain({ root });
  const bySession = changes.reduce((map, change) => {
    const entry = map.get(change.sessionId) ?? { files: new Set(), additions: 0, deletions: 0, samples: [] };
    if (change.file) entry.files.add(change.file);
    entry.additions += change.additions;
    entry.deletions += change.deletions;
    if (entry.samples.length < 4 && change.file) entry.samples.push(change.file);
    map.set(change.sessionId, entry);
    return map;
  }, new Map());
  return {
    generatedAt: new Date(now).toISOString(),
    sessions: sessions.map((session) => ({
      id: session.id,
      parentId: session.parentId,
      title: session.title,
      agent: session.agent,
      model: session.model?.id ?? "?",
      updatedMinutesAgo: Math.round((now - session.timeUpdated) / 60000),
      cost: Number(session.cost ?? 0).toFixed(3),
      finished: session.finished === true,
      todos: todos
        .filter((todo) => todo.sessionId === session.id)
        .slice(0, todoLimitPerSession)
        .map((todo) => ({ content: todo.content, status: todo.status })),
      changed: bySession.has(session.id)
        ? {
            files: [...bySession.get(session.id).files].slice(0, 5),
            additions: bySession.get(session.id).additions,
            deletions: bySession.get(session.id).deletions,
          }
        : null,
    })),
    collisions: collisions({ dbPath, root, now }).slice(0, 8).map((collision) => {
      const sessions = collision.sessions.map((entry) => ({
        sessionId: entry.sessionId,
        edits: entry.edits,
        firstEdit: entry.firstEdit,
        lastEdit: entry.lastEdit,
        files: entry.files,
        active: entry.active === true,
      }));
      return {
        file: collision.file,
        files: collision.files,
        sessions,
        owner: collision.owner,
        ownership: collision.ownership,
        overlap: collision.overlap,
        active: collision.active,
        handoff: collision.handoff === true,
        activeSessions: sessions.filter((entry) => entry.active).map((entry) => entry.sessionId),
      };
    }),
    // Who holds each live file right now — collisions are the multi-session
    // subset; a single editor still carries an owner so parallel work can
    // steer around it before a second session turns it into a collision.
    presence: filePresence({ dbPath, root, now }).slice(0, 12).map((row) => ({
      file: row.file,
      owner: row.owner,
      colliding: row.colliding,
      editors: row.editors.map((entry) => ({
        sessionId: entry.sessionId,
        edits: entry.edits,
        lastEdit: entry.lastEdit,
        active: entry.active === true,
      })),
    })),
    uncommitted: uncommittedOnly({ porcelain: dirtyText, sessions, changes, root }).slice(0, 8).map((row) => ({
      file: row.file,
      path: row.path,
      untracked: row.untracked,
      sessions: row.sessions,
      titles: row.titles,
      warning: row.warning,
    })),
  };
}

// CLI for tests: node scripts/eyes.mjs --dump --fixture <db> [--root <dir>]
async function cli() {
  const args = process.argv.slice(2);
  const fixture = args.includes("--fixture") ? args[args.indexOf("--fixture") + 1] : DEFAULT_DB;
  const root = args.includes("--root") ? args[args.indexOf("--root") + 1] : null;
  const nowRaw = args.includes("--now") ? Number(args[args.indexOf("--now") + 1]) : NaN;
  const now = Number.isFinite(nowRaw) ? nowRaw : Date.now();
  if (args.includes("--simulate")) {
    const sampleBriefing = {
      alerts: [
        { severity: "warn", title: "Two sessions editing main.lua", detail: "Both ses_a and ses_b modify main.lua.", sessionIds: ["ses_a", "ses_b"] },
        // Different wording, same session as the first alert: one root cause,
        // so this must not queue a second build session.
        { severity: "warn", title: "ses_b triage stalled", detail: "ses_b has not moved in hours.", sessionIds: ["ses_b"] },
        // A genuinely separate session still queues its own fix.
        { severity: "warn", title: "Unrelated file churn", detail: "ses_c only.", sessionIds: ["ses_c"] },
        { severity: "info", title: "ignore me", detail: "", sessionIds: [] },
      ],
    };
    const firstPass = requestsFromBriefing(sampleBriefing, []);
    // After a fix is dispatched its request leaves the queue, so the next pass
    // only has the assistant history to go on. The briefing then re-describes
    // the stall under new wording and even names the spawned fix session; the
    // history-shaped claims must still block a duplicate diagnosis.
    const dispatched = firstPass.map((request) => ({
      ...request,
      finishedAt: Date.now(),
      sessions: [...request.sessions, `spawned_${request.sessions[0]}`],
    }));
    const repeatBriefing = {
      alerts: [
        { severity: "warn", title: "Stalled triage again", detail: "Reworded repeat of an already-dispatched fix.", sessionIds: ["ses_a"] },
        { severity: "warn", title: "The fix session itself stalled", detail: "The alert names the spawned fix session.", sessionIds: ["spawned_ses_a"] },
      ],
    };
    // Same problem class, disjoint session ids: two build sessions used to
    // spawn for one stalled/duplicate-session root cause. A different
    // subsystem still queues on its own.
    const themeBriefing = {
      alerts: [
        { severity: "warn", title: "Duplicate root-cause sessions", detail: "Both address stalled/duplicate session root causes with near-identical scope.", sessionIds: ["ses_x", "ses_y"] },
        { severity: "warn", title: "Stalled duplicate-session triage", detail: "Two other sessions targeting the same stalled-session root-cause fix.", sessionIds: ["ses_p", "ses_q"] },
        { severity: "warn", title: "eyes.mjs subsystem overlap", detail: "Two sessions both target eyes.mjs collision handling.", sessionIds: ["ses_m", "ses_n"] },
        { severity: "warn", title: "Idle camera drift", detail: "The idle camera in renderer/idle.js is drifting.", sessionIds: ["ses_cam"] },
      ],
    };
    console.log(
      JSON.stringify(
        {
          fromCollisions: requestsFromCollisions(collisions({ dbPath: fixture, since: 0, now }), []),
          // Ownership shaping without DB timing games: a grouped two-file
          // collision with a split per-file ownership, an idle group, a
          // legacy collision missing an owner (falls back to first session),
          // and an inactive owner with a live peer (handoff, not a new owner).
          ownershipDemo: requestsFromCollisions(
            [
              {
                file: "C:/fixture/a.lua",
                files: ["C:/fixture/a.lua", "C:/fixture/b.lua"],
                owner: "ses_a",
                ownership: [
                  { file: "C:/fixture/a.lua", owner: "ses_a" },
                  { file: "C:/fixture/b.lua", owner: "ses_b" },
                ],
                sessions: [
                  { sessionId: "ses_a", edits: 5, lastEdit: 1_800_000_000_000, active: true },
                  { sessionId: "ses_b", edits: 2, lastEdit: 1_800_000_000_000, active: true },
                ],
                edits: 7,
                active: true,
              },
              {
                file: "C:/fixture/old.lua",
                files: ["C:/fixture/old.lua"],
                owner: "ses_old",
                ownership: [{ file: "C:/fixture/old.lua", owner: "ses_old" }],
                sessions: [
                  { sessionId: "ses_old", edits: 3, lastEdit: 0, active: false },
                  { sessionId: "ses_gone", edits: 1, lastEdit: 0, active: false },
                ],
                edits: 4,
                active: false,
              },
              {
                file: "C:/fixture/legacy.lua",
                files: ["C:/fixture/legacy.lua"],
                sessions: [{ sessionId: "ses_legacy", edits: 2 }, { sessionId: "ses_other", edits: 1 }],
                edits: 3,
              },
              {
                file: "C:/fixture/test_mefi_studio_eyes.py",
                files: [
                  "C:/fixture/test_mefi_studio_eyes.py",
                  "C:/fixture/eyes.mjs",
                  "C:/fixture/explorer.js",
                ],
                owner: "ses_owner",
                ownership: [
                  { file: "C:/fixture/test_mefi_studio_eyes.py", owner: "ses_owner" },
                  { file: "C:/fixture/eyes.mjs", owner: "ses_owner" },
                  { file: "C:/fixture/explorer.js", owner: "ses_owner" },
                ],
                sessions: [
                  {
                    sessionId: "ses_owner",
                    edits: 15,
                    lastEdit: 0,
                    active: false,
                    files: ["C:/fixture/test_mefi_studio_eyes.py", "C:/fixture/eyes.mjs", "C:/fixture/explorer.js"],
                  },
                  {
                    sessionId: "ses_peer",
                    edits: 13,
                    lastEdit: 1_800_000_000_000,
                    active: true,
                    files: ["C:/fixture/test_mefi_studio_eyes.py", "C:/fixture/eyes.mjs", "C:/fixture/explorer.js"],
                  },
                ],
                edits: 28,
                active: true,
                handoff: true,
              },
            ],
            []
          ),
          fromBriefing: firstPass,
          // Time-range shaping: a shared overlap window (prompt cites the
          // HH:MM–HH:MM the clash happened), a gap-tolerated handoff (the
          // sessions never co-edited, so the whole span is labelled a
          // handoff), a zero-length window (both sessions touched the same
          // instant: still a shared window), and a corrupt window (a
          // non-numeric end must fall back to the edit span, never print
          // "NaN–NaN").
          rangeDemo: requestsFromCollisions(
            [
              {
                file: "C:/fixture/ranged.lua",
                files: ["C:/fixture/ranged.lua"],
                owner: "ses_a",
                ownership: [{ file: "C:/fixture/ranged.lua", owner: "ses_a" }],
                overlap: { first: 1_800_000_900_000, last: 1_800_003_000_000 },
                sessions: [
                  { sessionId: "ses_a", edits: 5, firstEdit: 1_800_000_000_000, lastEdit: 1_800_003_600_000, active: true },
                  { sessionId: "ses_b", edits: 2, firstEdit: 1_800_001_200_000, lastEdit: 1_800_002_800_000, active: false },
                ],
                edits: 7,
                active: true,
              },
              {
                file: "C:/fixture/handoff.lua",
                files: ["C:/fixture/handoff.lua"],
                owner: "ses_old",
                ownership: [{ file: "C:/fixture/handoff.lua", owner: "ses_old" }],
                overlap: { first: 1_800_003_600_000, last: 1_800_000_000_000 },
                sessions: [
                  { sessionId: "ses_old", edits: 3, firstEdit: 1_800_000_000_000, lastEdit: 1_800_000_600_000, active: false },
                  { sessionId: "ses_new", edits: 2, firstEdit: 1_800_003_600_000, lastEdit: 1_800_004_200_000, active: true },
                ],
                edits: 5,
                active: true,
              },
              {
                file: "C:/fixture/instant.lua",
                files: ["C:/fixture/instant.lua"],
                owner: "ses_instant",
                ownership: [{ file: "C:/fixture/instant.lua", owner: "ses_instant" }],
                overlap: { first: 1_800_002_000_000, last: 1_800_002_000_000 },
                sessions: [
                  { sessionId: "ses_instant", edits: 1, firstEdit: 1_800_000_000_000, lastEdit: 1_800_002_000_000, active: true },
                  { sessionId: "ses_touch", edits: 1, firstEdit: 1_800_002_000_000, lastEdit: 1_800_003_600_000, active: false },
                ],
                edits: 2,
                active: true,
              },
              {
                file: "C:/fixture/corrupt.lua",
                files: ["C:/fixture/corrupt.lua"],
                owner: "ses_corrupt",
                ownership: [{ file: "C:/fixture/corrupt.lua", owner: "ses_corrupt" }],
                overlap: { first: "not-a-number", last: 1_800_003_000_000 },
                sessions: [
                  { sessionId: "ses_corrupt", edits: 3, firstEdit: 1_800_000_000_000, lastEdit: 1_800_001_000_000, active: true },
                  { sessionId: "ses_late", edits: 2, firstEdit: 1_800_001_500_000, lastEdit: 1_800_002_500_000, active: false },
                ],
                edits: 5,
                active: true,
              },
            ],
            []
          ),
          deduped: requestsFromBriefing(sampleBriefing, firstPass),
          historyDeduped: requestsFromBriefing(repeatBriefing, dispatched),
          themeDedup: requestsFromBriefing(themeBriefing, []),
          // A shared session on two different partners is two features, so
          // both queue. The same pair already in the inbox does not.
          pairDedup: requestsFromCollisions(
            [
              {
                file: "C:/fixture/a.lua",
                files: ["C:/fixture/a.lua"],
                owner: "ses_a",
                sessions: [
                  { sessionId: "ses_a", edits: 2, files: ["C:/fixture/a.lua"] },
                  { sessionId: "ses_b", edits: 1, files: ["C:/fixture/a.lua"] },
                ],
              },
              {
                file: "C:/fixture/c.lua",
                files: ["C:/fixture/c.lua"],
                owner: "ses_a",
                sessions: [
                  { sessionId: "ses_a", edits: 2, files: ["C:/fixture/c.lua"] },
                  { sessionId: "ses_c", edits: 1, files: ["C:/fixture/c.lua"] },
                ],
              },
            ],
            []
          ),
          samePairQueued: requestsFromCollisions(
            [
              {
                file: "C:/fixture/a.lua",
                files: ["C:/fixture/a.lua", "C:/fixture/b.lua"],
                owner: "ses_a",
                sessions: [
                  { sessionId: "ses_a", edits: 2, files: ["C:/fixture/a.lua", "C:/fixture/b.lua"] },
                  { sessionId: "ses_b", edits: 1, files: ["C:/fixture/a.lua"] },
                ],
              },
            ],
            [{ source: "collision", file: "C:/fixture/b.lua", sessions: ["ses_a", "ses_b"] }]
          ),
          uncommitted: uncommittedOnly({
            porcelain: " M mefi-studio/main.cjs\n?? mefi-studio/renderer/boot.js\n D gone.lua\n M other.lua\n",
            root: "C:/repo",
            sessions: [{ id: "ses_peer", title: "Wire the parallel executor", changed: { files: ["C:/repo/mefi-studio/main.cjs"] } }],
            changes: [
              { file: "C:/repo/mefi-studio/main.cjs", sessionId: "ses_peer" },
              { file: "C:/repo/mefi-studio/renderer/boot.js", sessionId: "ses_boot" },
            ],
          }),
          fromUncommitted: requestsFromUncommitted(
            uncommittedOnly({
              porcelain: " M mefi-studio/main.cjs\n",
              root: "C:/repo",
              changes: [{ file: "C:/repo/mefi-studio/main.cjs", sessionId: "ses_peer" }],
              sessions: [{ id: "ses_peer", title: "Wire the parallel executor" }],
            }),
            []
          ),
          duplicateDemo: duplicateDeclarations("export function foo() {}\nconst bar = 1;\nfunction foo() {}\n"),
          fromDuplicates: requestsFromDuplicates(
            [{ file: "C:/fixture/main.cjs", duplicates: [{ name: "foo", lines: [1, 3] }] }],
            []
          ),
          dupDeduped: requestsFromDuplicates(
            [{ file: "C:/fixture/main.cjs", duplicates: [{ name: "foo", lines: [1, 3] }] }],
            [{ source: "duplicate", file: "C:/fixture/main.cjs" }]
          ),
          adoptHit: adoptAdvice({
            title: "temporal overlap collisions",
            prompt: "root scoping",
            sessions: [{ id: "ses_peer", title: "temporal-overlap implementation for collisions()" }],
          }),
          adoptMiss: adoptAdvice({
            title: "Draw the tide pool fish",
            prompt: "sprite pass",
            sessions: [{ id: "ses_peer", title: "temporal-overlap implementation for collisions()" }],
          }),
        },
        null,
        2
      )
    );
  }
  if (args.includes("--dump")) {
    let porcelain = "";
    if (args.includes("--porcelain")) {
      const value = args[args.indexOf("--porcelain") + 1] ?? "";
      porcelain = existsSync(value) ? await readFile(value, "utf8") : String(value).replace(/\\n/g, "\n");
    }
    const payload = {
      sessions: listSessions({ dbPath: fixture }),
      changes: listChanges({ dbPath: fixture, limit: 50 }),
      todos: listTodos({ dbPath: fixture }),
      activity: activitySince({ dbPath: fixture, since: 0 }),
      collisions: collisions({ dbPath: fixture, since: 0, now }),
      collisionsScoped: collisions({ dbPath: fixture, since: 0, root, now }),
      presence: filePresence({ dbPath: fixture, since: 0, root, now }),
      uncommitted: uncommittedOnly({
        porcelain,
        sessions: listSessions({ dbPath: fixture }),
        changes: listChanges({ dbPath: fixture, limit: 50 }),
        root,
      }),
      facts: assistantFacts({ dbPath: fixture, root, now, porcelain }),
    };
    console.log(JSON.stringify(payload, null, 2));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

// ---- the board store: SQLite authority, JSON views ----------------------------
//
// The three board stores (requests, tasks, ideas) are relational — ideas link
// to tasks, claims (runId) point across stores, and one logical action (a plan
// merge, a claim, a settlement) touches several rows at once. Whole-file JSON
// cannot commit those together: a crash or interleaved writer between two file
// writes leaves dangling references (49 stranded ideas, once). So when the
// host enables the board store, these three stores live in one SQLite database
// OUTSIDE the synced data/ folder (OneDrive locks have bitten here before) and
// the JSON files become exported views: rewritten after every committed
// change, read only when the database is empty (first-run migration).
//
// Writers keep calling readJson/writeJson with the same paths — the calls are
// intercepted here. boardMutate is the read-modify-write primitive: reads and
// writes happen inside one BEGIN IMMEDIATE transaction, so the compare-step of
// every gateway pass sees and updates committed state atomically, even across
// processes (busy_timeout + retry arbitrate; WAL keeps readers unblocked).

const BOARD_GLOBAL = "__mefiBoardStore__";
const BOARD_KINDS = ["requests", "tasks", "ideas"];

// Deterministic default layout: ~/.local/share/mefi-studio/board.db, the same
// home-relative convention as the OpenCode store this module already reads.
// MEFI_STUDIO_BOARD_DB overrides it (tests, portable installs).
export function defaultBoardConfig(root) {
  const dataDir = path.join(root, "data");
  const dbPath = process.env.MEFI_STUDIO_BOARD_DB || path.join(os.homedir(), ".local", "share", "mefi-studio", "board.db");
  return {
    dbPath,
    files: {
      requests: path.join(dataDir, "eyes-requests.json"),
      tasks: path.join(dataDir, "eyes-tasks.json"),
      ideas: path.join(dataDir, "eyes-feature-ideas.json"),
    },
  };
}

function boardState() {
  // Shared across module instances (live update re-imports this file): one
  // connection per dbPath per process, whoever loads the module.
  globalThis[BOARD_GLOBAL] ??= { config: null, db: null, dbPath: null };
  return globalThis[BOARD_GLOBAL];
}

export function enableBoardStore({ dbPath, files } = {}) {
  const state = boardState();
  state.config = {
    dbPath: dbPath || process.env.MEFI_STUDIO_BOARD_DB || path.join(os.homedir(), ".local", "share", "mefi-studio", "board.db"),
    files: files || state.config?.files || {},
  };
  return { ok: true, dbPath: state.config.dbPath };
}

export function boardEnabled() {
  return Boolean(boardState().config);
}

function boardKindFor(pathname) {
  const state = boardState();
  if (!state.config || !pathname) return null;
  const key = String(pathname).replace(/[\\/]+/g, "/").toLowerCase();
  for (const kind of BOARD_KINDS) {
    const file = state.config.files[kind];
    if (file && key === String(file).replace(/[\\/]+/g, "/").toLowerCase()) return kind;
  }
  return null;
}

const BOARD_SCHEMA_VERSION = "3";
const BOARD_TABLE_COLUMNS = ["id", "pos", "title", "status", "source", "run_id", "at", "created_at", "updated_at", "task_id", "read", "data"];
const BOARD_TABLE_DDL = (kind) => `
create table if not exists board_${kind} (
  pos integer primary key,
  id text,
  title text, status text, source text, run_id text, at integer,
  created_at integer, updated_at integer, task_id text, read integer,
  data text not null
);`;

// Create-or-upgrade the board tables. An older layout (this store shipped
// hours ago and the app restarts into new code mid-life) is rebuilt in place,
// preserving every row's `data` payload — the payload IS the record; the
// extracted columns are just derived convenience, so a rebuild re-derives
// them instead of losing history.
function ensureBoardSchema(db) {
  db.exec("create table if not exists board_meta (key text primary key, value text);");
  for (const kind of BOARD_KINDS) {
    const info = db.prepare(`pragma table_info(board_${kind})`).all();
    if (!info.length) {
      db.exec(BOARD_TABLE_DDL(kind));
      continue;
    }
    const names = new Set(info.map((row) => row.name));
    if (BOARD_TABLE_COLUMNS.every((column) => names.has(column))) continue;
    const rows = db.prepare(`select pos, data from board_${kind} order by pos`).all();
    withBoardWriteLock(db, () => {
      db.exec(`drop table board_${kind}`);
      db.exec(BOARD_TABLE_DDL(kind));
      const insert = db.prepare(
        `insert into board_${kind} (pos, id, title, status, source, run_id, at, created_at, updated_at, task_id, read, data)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const row of rows) {
        let parsed = null;
        try {
          parsed = JSON.parse(row.data);
        } catch {
          continue; // unparseable payload: nothing to preserve
        }
        insert.run(row.pos, ...BOARD_COLUMNS(parsed), row.data);
      }
    });
  }
  db.exec("create index if not exists idx_board_requests_status on board_requests (status);");
  db.exec("create index if not exists idx_board_requests_run on board_requests (run_id);");
  db.exec("create index if not exists idx_board_tasks_status on board_tasks (status);");
  db.exec("create index if not exists idx_board_tasks_run on board_tasks (run_id);");
  db.exec("create index if not exists idx_board_ideas_task on board_ideas (task_id);");
  // Storage-level task-id uniqueness: the primary key is array position, which
  // let two generators that minted the same plan id conflate distinct jobs.
  // The unique index turns a duplicate write into a rolled-back, loudly
  // failing mutation instead of a silent claim collision. Legacy databases
  // that already carry duplicate ids cannot take the index; they log and keep
  // working file-grade until scripts/reconcile-board.mjs heals the rows.
  try {
    db.exec("create unique index if not exists idx_board_tasks_id on board_tasks (id) where id is not null;");
  } catch (error) {
    console.error(`[board-store] task-id uniqueness unavailable (duplicate legacy ids? run scripts/reconcile-board.mjs): ${error.message}`);
  }
  db.prepare("insert or replace into board_meta (key, value) values ('schema_version', ?)").run(BOARD_SCHEMA_VERSION);
}

function openBoardDb(dbPath) {
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath, { readOnly: false });
  db.exec("pragma journal_mode = wal;");
  db.exec("pragma busy_timeout = 5000;");
  db.exec("pragma synchronous = normal;");
  ensureBoardSchema(db);
  return db;
}

function getBoardDb() {
  const state = boardState();
  if (!state.config) return null;
  if (state.db && state.dbPath === state.config.dbPath) return state.db;
  if (state.db) {
    try { state.db.close(); } catch {}
    state.db = null;
  }
  try {
    state.db = openBoardDb(state.config.dbPath);
  } catch (error) {
    // Degrade once, permanently for this process: plain-file mode is strictly
    // better than a half-working store, and quieter than failing every call.
    console.error(`[board-store] unavailable, falling back to files: ${error.message}`);
    state.config = null;
    return null;
  }
  state.dbPath = state.config.dbPath;
  migrateBoardFromViews(state.db, state.config.files);
  if (!guardBoardFork(state.db, state.config.files)) {
    try { state.db.close(); } catch {}
    state.db = null;
    state.dbPath = null;
    state.config = null;
    return null;
  }
  return state.db;
}

// First run on a machine: the JSON views hold the backlog and the database is
// empty, so import them wholesale (one transaction, ids preserved). Afterwards
// the database wins for good — a hand-edited view is a stale export, never a
// competing authority. Duplicate task ids in a legacy export (the colliding
// plan generators once minted them) are collapsed on the first id seen, so a
// poisoned view cannot wedge the store against its own uniqueness index.
function migrateBoardFromViews(db, files) {
  const flag = db.prepare("select value from board_meta where key = 'migrated'").get();
  if (flag?.value === "1") return;
  withBoardWriteLock(db, () => {
    for (const kind of BOARD_KINDS) {
      const file = files?.[kind];
      if (!file || !existsSync(file)) continue;
      let rows = null;
      try {
        rows = JSON.parse(readFileSync(file, "utf8"));
      } catch {
        continue; // torn view: the database state stands
      }
      if (!Array.isArray(rows) || !rows.length) continue;
      let list = rows;
      if (kind === "tasks") {
        const seen = new Set();
        const dropped = new Set();
        for (const row of rows) {
          const id = String(row?.id ?? "");
          if (!id || !seen.has(id)) {
            if (id) seen.add(id);
            continue;
          }
          dropped.add(row);
        }
        if (dropped.size) {
          console.error(`[board-store] migrated view carried ${dropped.size} duplicate task id(s); keeping the first of each`);
          list = rows.filter((row) => !dropped.has(row));
        }
      }
      storeRowsInTx(db, kind, list);
    }
    db.prepare("insert or replace into board_meta (key, value) values ('migrated', '1')").run();
  });
}

// The fork guard: "the database wins for good" assumes the views stopped
// being written the moment the store was adopted. They did not always — an
// app that runs plain-file (store never enabled, e.g. this repo's host)
// keeps evolving the views while a dormant migrated database sits under the
// home directory. Enabling the store on that machine would export the stale
// database OVER the fresher views on the first write, silently dropping
// every row the views gained. Seen live: db 38 tasks/151 drained ideas vs
// views 43 tasks/22 drained ideas, newest row hours apart. So at open time,
// if a view holds ids the database has never seen, the database is a stale
// fork, not an authority: degrade loudly to file mode (the views win) and
// make the operator reconcile explicitly. The reverse skew (database ahead
// of its own export, a normal commit in flight) passes.
function guardBoardFork(db, files) {
  for (const kind of BOARD_KINDS) {
    const file = files?.[kind];
    if (!file || !existsSync(file)) continue;
    let view = null;
    try {
      view = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue; // torn view: nothing to compare, migration rules already applied
    }
    if (!Array.isArray(view)) continue;
    const dbIds = new Set(
      readRowsInTx(db, kind).map((row) => String(row?.id ?? "")).filter(Boolean)
    );
    if (!dbIds.size) continue; // empty table: first-run migration owns this case
    const missing = [];
    for (const row of view) {
      const id = String(row?.id ?? "");
      if (id && !dbIds.has(id)) missing.push(id);
    }
    if (!missing.length) continue;
    console.error(
      `[board-store] stale fork: the ${kind} view holds ${missing.length} row(s) the database has never seen ` +
      `(e.g. ${missing.slice(0, 3).join(", ")}). Refusing to treat the database as authority — ` +
      `falling back to the files. Reconcile explicitly before enabling: ` +
      `node scripts/reconcile-board.mjs --data=<dir> (plain-file pass), or migrate the views into the database.`
    );
    return false;
  }
  return true;
}

// BEGIN IMMEDIATE takes the write lock up front, so the reads inside see and
// hold committed state through the commit — the property whole-file writes
// never had. busy_timeout waits; a residual SQLITE_BUSY retries a few times.
function withBoardWriteLock(db, fn, { attempts = 4 } = {}) {
  let lastError = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      db.exec("begin immediate");
    } catch (error) {
      lastError = error;
      if (!/busy/i.test(String(error?.message))) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200 * (attempt + 1));
      continue;
    }
    try {
      const out = fn();
      db.exec("commit");
      return out;
    } catch (error) {
      try { db.exec("rollback"); } catch {}
      throw error;
    }
  }
  throw lastError ?? new Error("board store busy");
}

// Column extraction per kind: the hot identity fields the SQL layer wants for
// indexes and future targeted updates. `data` carries the FULL row verbatim —
// the JSON view and every consumer round-trip through it byte-for-byte in
// content (key order aside), so nothing about the row shape is lost. All
// three tables share one column layout; kinds leave the columns they don't
// have as null.
const BOARD_COLUMNS = (row) => [
  row?.id != null ? String(row.id) : null,
  row?.title ?? null,
  row?.status ?? null,
  row?.source ?? null,
  row?.runId ?? null,
  Number.isFinite(row?.at) ? row.at : null,
  Number.isFinite(row?.createdAt) ? row.createdAt : null,
  Number.isFinite(row?.updatedAt) ? row.updatedAt : null,
  row?.taskId ?? null,
  row?.read === true ? 1 : 0,
];

function storeRowsInTx(db, kind, rows) {
  const list = (Array.isArray(rows) ? rows : []).filter((row) => row !== null && typeof row === "object");
  db.prepare(`delete from board_${kind}`).run();
  const insert = db.prepare(
    `insert into board_${kind} (pos, id, title, status, source, run_id, at, created_at, updated_at, task_id, read, data)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const [pos, row] of list.entries()) {
    insert.run(pos, ...BOARD_COLUMNS(row), JSON.stringify(row));
  }
  return list.length;
}

function readRowsInTx(db, kind) {
  const rows = db.prepare(`select data from board_${kind} order by pos`).all();
  const out = [];
  for (const row of rows) {
    try {
      out.push(JSON.parse(row.data));
    } catch {
      // Unparseable rows cannot come from storeRowsInTx; skip rather than
      // poison the store view.
    }
  }
  return out;
}

// View refresh after a committed change — the database is the authority, but
// callers have always been able to read the file right after writeJson, so
// the refresh is part of the write (awaited), not a background maybe.
function writeView(kind, rows) {
  const state = boardState();
  const file = state.config?.files?.[kind];
  if (!file) return Promise.resolve();
  const payload = JSON.stringify(rows, null, 2);
  const tmp = `${file}.viewtmp-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  return writeFile(tmp, payload)
    .then(() => rename(tmp, file))
    .catch(() => writeFile(file, payload).catch(() => {}))
    .finally(() => rm(tmp, { force: true }).catch(() => {}));
}

export function boardRead(kind, fallback = []) {
  const state = boardState();
  if (!state.config) return fallback;
  const db = getBoardDb();
  if (!db) return fallback; // degraded mid-call: the open path logged why
  try {
    return readRowsInTx(db, kind);
  } catch (error) {
    console.error(`[board-store] read failed (${kind}): ${error.message}`);
    return fallback;
  }
}

export async function boardWrite(kind, rows) {
  const db = getBoardDb();
  if (!db) {
    // Store degraded to file mode (open failed once): behave as if never
    // enabled so the caller's write lands in the plain file.
    const state = boardState();
    const file = state.config?.files?.[kind];
    if (file) await writeFile(file, JSON.stringify(rows, null, 2));
    return { ok: true, degraded: true };
  }
  let count = 0;
  // A transaction failure propagates: a silent fallback here would split the
  // authority between the database and the view, which is the bug class this
  // store exists to kill. Callers already treat store failures as errors.
  withBoardWriteLock(db, () => {
    count = storeRowsInTx(db, kind, rows);
  });
  await writeView(kind, Array.isArray(rows) ? rows : []);
  return { ok: true, count };
}

// The board read-modify-write primitive: the mutator sees a WORKING COPY of
// the committed arrays (in-place row edits are expected — pins, refs, status
// changes) and returns replacements or a patch; only stores whose content
// actually differs from the pristine read are rewritten, all inside one
// transaction. Returns the patch plus { requests, tasks, ideas, written }, or
// null when disabled (the caller falls back to files).
//
// The mutator MUST be synchronous: the transaction wraps DatabaseSync calls,
// so awaiting inside it would hold the write lock across unknown async work,
// and a mutator whose returned patch is a Promise silently loses every
// replacement array while keeping its in-place edits — partial application.
// A thenable return therefore rolls the transaction back and fails loudly;
// callers gather awaited inputs before entering the mutation.
export async function boardMutate(mutator) {
  const db = getBoardDb();
  if (!db) return null;
  let outcome = null;
  const written = withBoardWriteLock(db, () => {
    const before = {
      requests: readRowsInTx(db, "requests"),
      tasks: readRowsInTx(db, "tasks"),
      ideas: readRowsInTx(db, "ideas"),
    };
    const working = structuredClone(before);
    const returned = mutator(working);
    if (returned && typeof returned.then === "function") {
      // The mutator already mutated the working copy, but nothing it did is
      // committed — the throw below rolls the transaction back. Tag the stray
      // promise so its eventual rejection (the real cause) is logged instead
      // of crashing the process as an unhandled rejection.
      Promise.resolve(returned).catch((error) => {
        console.error(`[board-store] async mutator rejected (its edits were rolled back): ${error?.message ?? error}`);
      });
      throw new TypeError("boardMutate: mutator must be synchronous — await inputs before the transaction, not inside it");
    }
    const patch = returned ?? {};
    const result = {
      requests: patch.requests ?? working.requests,
      tasks: patch.tasks ?? working.tasks,
      ideas: patch.ideas ?? working.ideas,
    };
    const changed = [];
    for (const kind of BOARD_KINDS) {
      if (result[kind] === before[kind]) continue;
      if (JSON.stringify(result[kind]) === JSON.stringify(before[kind])) continue;
      storeRowsInTx(db, kind, result[kind]);
      changed.push(kind);
    }
    outcome = { ...patch, requests: result.requests, tasks: result.tasks, ideas: result.ideas, written: changed };
    return changed;
  });
  for (const kind of written) await writeView(kind, outcome[kind]);
  return outcome;
}

// Repair a broken board view the way the authority demands: the JSON files are
// EXPORTS once the store is enabled, so a torn view is quarantined and
// regenerated FROM the database — never salvaged back into it. The old fix
// pass salvaged the file's parseable prefix (or chose the empty fallback) and
// wrote the result through writeJson, which with the store enabled REPLACED
// the database rows: valid tasks disappeared because their export was torn.
// Returns { handled: false } when the path is not a store-backed view (or the
// store degraded to files — then the file IS the authority and the caller's
// ordinary salvage path applies).
export async function repairBoardView(pathname) {
  const state = boardState();
  const kind = boardKindFor(pathname);
  if (!kind || !state.config) return { handled: false };
  const db = getBoardDb();
  if (!db) return { handled: false };
  // Quarantine the torn export for forensics; regenerate the view from the
  // committed rows. Older `.broken-*` siblings of this view are stale the
  // moment the fresh export lands — sweep them, keep the new one.
  let quarantine = null;
  try {
    quarantine = `${pathname.slice(0, -path.extname(pathname).length)}.broken-${Date.now()}${path.extname(pathname)}`;
    await rename(pathname, quarantine);
  } catch {
    quarantine = null; // nothing to set aside (or the rename was refused); still regenerate
  }
  const rows = readRowsInTx(db, kind);
  await writeView(kind, rows);
  if (quarantine) {
    const stem = `${path.basename(pathname, path.extname(pathname))}.broken-`;
    try {
      for (const name of await readdir(path.dirname(pathname))) {
        if (name.startsWith(stem) && path.join(path.dirname(pathname), name) !== quarantine) {
          await rm(path.join(path.dirname(pathname), name), { force: true }).catch(() => {});
        }
      }
    } catch {}
  }
  return { handled: true, kind, count: rows.length, quarantine };
}

// Test/CLI hook: close the connection so temp databases are releasable on
// Windows. The next board call reopens transparently.
export function closeBoardStore() {
  const state = boardState();
  if (state.db) {
    try { state.db.close(); } catch {}
    state.db = null;
    state.dbPath = null;
  }
}

// ---- usage ledger: every assistant turn OpenCode recorded -----------------
// The usage tracker's second source. The message table holds one row per
// assistant turn with the provider, model, tokens and the cost OpenCode
// computed, so a coding session on Go, Zen, OpenRouter or the Studio-managed
// z.ai provider is accounted per turn, per day and per provider; the session
// table has only the per-session sum and no time per turn. A whole-table pass
// (25k assistant rows measured) costs seconds, so rows are read from the
// newest end by rowid and kept in a per-store cache: a later read pays for the
// new tail plus a re-read of the last rows, because OpenCode writes a turn's
// tokens and cost into the same row when the turn completes. The cache lives
// on the eyes worker beside the reader; the main process only receives rows.
const USAGE_PAGE = 4000;
const USAGE_TAIL = 400;
const USAGE_DAY_MS = 86400000;
const USAGE_COLUMNS = `m.rowid rid, m.id, m.session_id, m.time_created, m.data, s.directory, s.agent
     from message m left join session s on s.id = m.session_id`;
const usageCaches = new Map();
const finiteNumber = (value) => (typeof value === "number" && Number.isFinite(value) ? value : null);

function usageRowOf(row) {
  let data;
  try { data = JSON.parse(row.data); } catch { return null; }
  if (!data || typeof data !== "object" || data.role !== "assistant") return null;
  const tokens = data.tokens && typeof data.tokens === "object" ? data.tokens : {};
  const cache = tokens.cache && typeof tokens.cache === "object" ? tokens.cache : {};
  return {
    rowid: row.rid,
    id: row.id,
    sessionId: row.session_id,
    directory: row.directory ?? (typeof data.path?.cwd === "string" ? data.path.cwd : null),
    agent: typeof data.agent === "string" ? data.agent : (row.agent ?? null),
    at: finiteNumber(data.time?.created) ?? row.time_created,
    completedAt: finiteNumber(data.time?.completed),
    provider: typeof data.providerID === "string" ? data.providerID : null,
    model: typeof data.modelID === "string" ? data.modelID : null,
    cost: finiteNumber(data.cost),
    tokens: {
      input: finiteNumber(tokens.input) ?? 0,
      output: finiteNumber(tokens.output) ?? 0,
      reasoning: finiteNumber(tokens.reasoning) ?? 0,
      cacheRead: finiteNumber(cache.read) ?? 0,
      cacheWrite: finiteNumber(cache.write) ?? 0,
      total: finiteNumber(tokens.total),
    },
    finish: typeof data.finish === "string" ? data.finish : null,
    error: typeof data.error?.name === "string" ? data.error.name : (data.error ? "error" : null),
  };
}

export function usageLedger({ dbPath = DEFAULT_DB, root = null, since = null, now = Date.now(), limit = 60000 } = {}) {
  if (!storePresent(dbPath)) return { ok: true, rows: [], scanned: 0, since: null, warm: false, total: 0 };
  const db = openDb(dbPath);
  const from = finiteNumber(since) ?? now - 35 * USAGE_DAY_MS;
  const top = db.prepare("select max(rowid) top from message").get()?.top ?? 0;
  const page = db.prepare(`select ${USAGE_COLUMNS} where m.rowid > ? and m.rowid <= ? order by m.rowid desc`);
  let cache = usageCaches.get(dbPath);
  if (!cache || cache.since > from) {
    cache = { since: from, top: 0, rows: new Map() };
    usageCaches.set(dbPath, cache);
  }
  const warm = cache.top > 0;
  let scanned = 0;
  const absorb = (rows) => {
    let oldest = null;
    for (const raw of rows) {
      scanned += 1;
      oldest = oldest === null ? raw.time_created : Math.min(oldest, raw.time_created);
      const row = usageRowOf(raw);
      if (!row) { cache.rows.delete(raw.id); continue; }
      if (row.at < from) continue;
      cache.rows.set(row.id, row);
    }
    return oldest;
  };
  if (!warm) {
    // A cold cache: page down from the newest row until a page reaches back
    // past the window (rows are appended in time order) or the table ends.
    let upper = top;
    while (upper > 0) {
      const lower = Math.max(0, upper - USAGE_PAGE);
      const oldest = absorb(page.all(lower, upper));
      upper = lower;
      if (oldest !== null && oldest < from) break;
    }
  } else {
    // A warm cache: the new rows plus the recent tail, whose tokens and cost
    // OpenCode fills in when a turn completes.
    absorb(page.all(Math.max(0, Math.min(cache.top, top) - USAGE_TAIL), top));
    // Turns still running when they left the tail are re-read by id.
    const open = [...cache.rows.values()].filter((row) => row.completedAt === null && row.rowid <= top - USAGE_TAIL).slice(0, 200);
    if (open.length) {
      const byId = db.prepare(`select ${USAGE_COLUMNS} where m.id = ?`);
      for (const row of open) {
        const fresh = byId.get(row.id);
        if (fresh) absorb([fresh]);
        else cache.rows.delete(row.id);
      }
    }
  }
  cache.top = top;
  cache.since = from;
  for (const [id, row] of cache.rows) if (row.at < from) cache.rows.delete(id);
  const rows = [];
  for (const row of cache.rows.values()) {
    if (root && !containsPath(root, row.directory)) continue;
    const { rowid: _rowid, ...out } = row;
    rows.push(out);
  }
  rows.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return { ok: true, rows: rows.length > limit ? rows.slice(rows.length - limit) : rows, scanned, since: from, warm, total: cache.rows.size };
}

// Test/CLI hook: same contract for the read-only store openDb() caches —
// close it so a temp fixture database is deletable; the next read reopens.
export function closeReadDb() {
  if (cached) {
    try { cached.db.close(); } catch {}
    cached = null;
  }
}
