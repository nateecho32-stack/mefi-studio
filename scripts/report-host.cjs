"use strict";
// Mefi's Studio AI+ — the host half of Report a problem and the crash prompt:
// the one object main.cjs's "Report a problem" block calls from its report:*
// handlers and from a few guarded hooks. scripts/crash-report.cjs decides what
// a report holds and how a session ended; this module does the reading,
// writing, asking and showing in between, with every collaborator passed in
// (like scripts/git-host.cjs), so a test can run it against a temp folder.
//
//   the session marker   boot() reads the last session's marker beside the
//                        crash record, judges it (crash-report judgeSession),
//                        writes a new "running" marker and keeps what to say;
//                        end() closes the marker with the reason Studio chose
//                        (quit, exit, session end); a marker still "running"
//                        at the next start is a session that never closed
//   the crash record     record() appends a row to data/crash.jsonl when the
//                        window dies or hangs or main throws: synchronous and
//                        tiny, because it can be the last thing a process does;
//                        the file keeps the last 50 rows of the last 7 days
//   the prompt           pageUp() says "Studio closed unexpectedly" (report:crashed)
//                        once the page is up, once per crash, unless
//                        MEFI_STUDIO_NO_CRASH_PROMPT=1 or the setting is off;
//                        dismiss() clears it
//   the report           preview() builds the bundle and answers every file's
//                        name, size and text with a token; save() writes exactly
//                        that previewed bundle where a Save dialog says (the
//                        Documents folder may live in OneDrive), shows it in
//                        the file manager and sends it nowhere
//
// Nothing here uses the network. A failure in the record, the marker or the
// prompt is logged and swallowed: it never stops Studio starting, quitting or
// running. Guarded by tests/report_host.test.mjs.

const path = require("node:path");

const PREVIEW_MS = 15 * 60 * 1000;
const PREVIEWS_KEPT = 3;
const MARKER_FILE = "session-marker.json";
const CRASH_FILE = "crash.jsonl";
// data/crash.jsonl is rewritten to its newest 50 rows of the last week once it grows past this
// (fifty of the longest rows fit under it, so it is not rewritten on every append).
const CRASH_FILE_MAX = 24 * 1024;
// The page needs a moment after did-finish-load to hear the prompt.
const PROMPT_DELAY_MS = 2500;
// The same kind of trouble inside this many milliseconds is one row.
const RECORD_GAP_MS = 30 * 1000;

function createReportHost({
  fs, rep, zip, dataDir, updateResultPath = null, env = {}, now = () => Date.now(), pid = 0, version = "", install = "source",
  collect = async () => ({}), showSaveDialog = null, showItemInFolder = null, documentsPath = () => "", getWindow = () => null,
  send = () => {}, readSettings = async () => ({}), updateSettings = async () => {}, log = () => {}, id = () => Math.random().toString(16).slice(2, 14),
} = {}) {
  const markerPath = path.join(dataDir, MARKER_FILE);
  const crashPath = path.join(dataDir, CRASH_FILE);
  const clock = () => (typeof now === "function" ? now() : Date.now());
  const say = (line) => { try { log(line); } catch { /* logging never stops a report */ } };
  // A log line names what went wrong by code, never by the message: an fs error's
  // message carries the path, and with it the person's user name.
  const why = (error) => String(error?.code ?? error?.name ?? "error").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 40) || "error";
  let marker = null;
  const previewed = new Map();
  const recent = new Map(); // kind -> when it was last recorded, so a hang is one row, not one per second
  let pending = null; // what the next pageUp says: { at, kind, session }
  let pushed = false;
  let judged = null;

  // ---- the crash record ----------------------------------------------------------------------
  function readRows() {
    try { return rep.parseRows(fs.readFileSync(crashPath, "utf8")); } catch { return []; }
  }
  function writeRows(rows) {
    const temp = `${crashPath}.tmp-${pid}`;
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(temp, rep.serializeRows(rows));
    fs.renameSync(temp, crashPath);
  }
  function append(row) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.appendFileSync(crashPath, rep.serializeRows([row]));
      let size = 0;
      try { size = fs.statSync(crashPath).size; } catch { /* the append above just made it */ }
      if (size > CRASH_FILE_MAX) writeRows(rep.keepRows(readRows(), { now: clock() }));
      return true;
    } catch (error) {
      say(`[report] could not write the crash record (${why(error)})`);
      return false;
    }
  }
  /** One row for the window dying or hanging, or main throwing: tied to this session, kept short. */
  function record(kind, detail = "", extra = {}) {
    if (!rep.CRASH_KINDS.includes(kind)) return false;
    const at = clock();
    if (at - (recent.get(kind) ?? -Infinity) < RECORD_GAP_MS) return false;
    recent.set(kind, at);
    return append(rep.crashRow({ now: clock(), kind, detail, session: marker?.startedAt ?? null, version, ...extra }));
  }

  // ---- the session marker ------------------------------------------------------------------------
  function writeMarker(next) {
    const temp = `${markerPath}.tmp-${pid}`;
    try {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(temp, JSON.stringify(next));
      fs.renameSync(temp, markerPath);
      marker = next;
      return true;
    } catch (error) {
      try { fs.rmSync(temp, { force: true }); } catch { /* nothing to remove */ }
      say(`[report] could not write the session marker (${why(error)})`);
      return false;
    }
  }

  function readUpdateResult() {
    if (!updateResultPath) return null;
    try { return JSON.parse(fs.readFileSync(updateResultPath, "utf8").replace(/^﻿/, "")); } catch { return null; }
  }

  /**
   * A launch: judge the session before this one, note it in the record, and
   * start this session's marker. Answers the judgement { crashed, prompt, kind,
   * at, ... }; what to say is kept for pageUp().
   */
  function boot() {
    let previous = null;
    try { previous = rep.parseMarker(fs.readFileSync(markerPath, "utf8")); } catch { previous = null; }
    const rows = readRows();
    judged = rep.judgeSession(previous, { pid, rows, updateResult: readUpdateResult() });
    if (judged.crashed) {
      // A session that wrote nothing down still leaves a row, so a report can say it.
      if (!judged.recorded) append(rep.crashRow({ now: clock(), kind: judged.kind, session: judged.session, version: previous?.version ?? "", detail: judged.kind === "update-rolled-back" ? "an update did not start and was rolled back" : "the last session did not close properly" }));
      say(`[report] the last session did not close properly (${judged.kind})${judged.prompt ? "" : "; no prompt"}`);
    }
    pending = judged.crashed && judged.prompt ? { at: judged.at, kind: judged.kind, session: judged.session } : null;
    pushed = false;
    writeMarker(rep.beginSession({ now: clock(), pid, version, install }));
    return judged;
  }

  /** Studio is closing on purpose. Idempotent; the first reason stands. */
  function end(why = "quit") {
    const closed = rep.endSession(marker, { now: clock(), why });
    return closed ? writeMarker(closed) : false;
  }

  // ---- the prompt -----------------------------------------------------------------------------------
  const promptKilled = () => env.MEFI_STUDIO_NO_CRASH_PROMPT === "1";
  async function promptOn() {
    try { return (await readSettings())?.report?.prompt !== false; } catch { return true; }
  }

  /** The page is up: say "Studio closed unexpectedly", once, unless the owner or the environment said not to. */
  async function pageUp() {
    if (!pending || pushed || promptKilled() || !(await promptOn())) return false;
    pushed = true;
    try { send({ at: pending.at, kind: pending.kind }); return true; } catch (error) { say(`[report] could not send the crash prompt (${why(error)})`); return false; }
  }

  /** "Dismiss": the prompt is cleared and the crash is marked dismissed in the record. */
  function dismiss() {
    const was = pending;
    pending = null;
    if (was) append(rep.crashRow({ now: clock(), kind: "dismissed", session: was.session }));
    return { ok: true, dismissed: Boolean(was) };
  }

  async function setPrompt(on) {
    if (typeof on !== "boolean") return { ok: false, error: "The switch is on or off." };
    await updateSettings((settings) => {
      if ((settings.report?.prompt !== false) === on) return false;
      settings.report = { ...(settings.report ?? {}), prompt: on };
    });
    return state();
  }

  async function state() {
    const rows = rep.bundleCrashRows(readRows(), { now: clock() });
    const last = rows[rows.length - 1] ?? null;
    return { ok: true, prompt: await promptOn(), killed: promptKilled(), crash: last ? { at: last.at, kind: last.kind } : null, crashes: rows.length, pending: Boolean(pending) && !pushed };
  }

  // ---- the report --------------------------------------------------------------------------------------
  const stamp = (at) => new Date(at).toISOString().slice(0, 10);

  /** Build the bundle and hand every file's text back, with a token that says "this is what you read". */
  async function preview({ replaceTitles = false, includeCrash = true } = {}) {
    const at = clock();
    let inputs = null;
    try { inputs = await collect(); } catch (error) { return { ok: false, error: `The report could not be built: ${String(error?.message ?? error).slice(0, 160)}` }; }
    const bundle = rep.buildBundle({ ...inputs, now: at, crashRows: readRows() }, { replaceTitles: replaceTitles === true, includeCrash: includeCrash !== false });
    const token = id();
    previewed.set(token, { at, files: bundle.files });
    while (previewed.size > PREVIEWS_KEPT) previewed.delete(previewed.keys().next().value);
    const rows = rep.bundleCrashRows(readRows(), { now: at });
    const last = rows[rows.length - 1] ?? null;
    return {
      ok: true, token, builtAt: at, replaceTitles: bundle.replacedTitles, includeCrash: includeCrash !== false, total: bundle.total,
      files: bundle.files.map((file) => ({ name: file.name, about: file.about, bytes: file.bytes, truncated: file.truncated === true, text: file.text })),
      crash: last ? { at: last.at, kind: last.kind } : null,
      never: rep.NEVER_INCLUDED.map((item) => ({ ...item })),
      prompt: await promptOn(), killed: promptKilled(),
    };
  }

  /** Save the previewed bundle where a Save dialog says, then show it. Never sends it anywhere. */
  async function save({ token } = {}) {
    const held = previewed.get(String(token ?? ""));
    if (!held || clock() - held.at > PREVIEW_MS) return { ok: false, stale: true, error: "Read the report again first: what you saw is no longer held." };
    if (typeof showSaveDialog !== "function") return { ok: false, error: "Saving is not available here." };
    let picked = null;
    try {
      picked = await showSaveDialog(getWindow(), {
        title: "Save the report", defaultPath: path.join(String(documentsPath() || ""), `Studio-report-${stamp(clock())}.zip`),
        filters: [{ name: "Zip archive", extensions: ["zip"] }], properties: ["showOverwriteConfirmation"],
      });
    } catch (error) { return { ok: false, error: `The Save dialog did not open: ${String(error?.message ?? error).slice(0, 160)}` }; }
    if (!picked || picked.canceled || !picked.filePath) return { ok: false, canceled: true };
    const target = /\.zip$/i.test(String(picked.filePath)) ? String(picked.filePath) : `${picked.filePath}.zip`;
    try {
      const bytes = zip.zip(held.files.map((file) => ({ name: file.name, data: file.text })), { at: clock() });
      const temp = `${target}.tmp-${pid}`;
      await fs.promises.writeFile(temp, bytes);
      try { await fs.promises.rename(temp, target); } catch (error) { await fs.promises.rm(temp, { force: true }).catch(() => {}); throw error; }
      try { if (typeof showItemInFolder === "function") showItemInFolder(target); } catch { /* the file is saved; showing it is a courtesy */ }
      say(`[report] saved a report (${bytes.length} bytes, ${held.files.length} files); nothing was sent`);
      return { ok: true, path: target, bytes: bytes.length, files: held.files.map((file) => file.name) };
    } catch (error) {
      return { ok: false, error: `The report was not saved: ${String(error?.message ?? error).slice(0, 160)}` };
    }
  }

  return { boot, end, record, pageUp, dismiss, setPrompt, state, preview, save, PROMPT_DELAY_MS, files: { marker: markerPath, crash: crashPath } };
}

module.exports = { createReportHost, PREVIEW_MS, MARKER_FILE, CRASH_FILE, CRASH_FILE_MAX, PROMPT_DELAY_MS, RECORD_GAP_MS };
