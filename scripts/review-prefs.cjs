// What Studio keeps and runs around each builder attempt, and the three ways
// each can be switched off (docs/architecture.md "Attempt review"). Nothing
// here happens because the owner asked for it in the moment: a picture of the
// folder at the start and end of an attempt, advisory checks after it, and a
// screenshot of the preview. So each has a setting the owner can turn off
// (settings.review) and an environment variable that wins over the setting:
//
//   snapshots     before/after snapshots and the changed-files list
//                 (MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS=1)
//   advisory      the lint and typecheck run after an attempt, and the
//                 run_check / project_logs tools a builder may call
//                 (MEFI_STUDIO_NO_ADVISORY_CHECKS=1)
//   advisoryBuild the build joins that run (off by default: a build writes
//                 files into the folder)
//   shots         before/after screenshots of the project preview
//                 (MEFI_STUDIO_NO_EVIDENCE_SHOTS=1)
//
// Pure module: no Electron, no filesystem, no network, no processes, no
// timers, no clock reads. The host reads settings and the environment and
// passes them in.
"use strict";

const DEFAULTS = Object.freeze({ snapshots: true, advisory: true, advisoryBuild: false, shots: true });
const SWITCHES = Object.freeze({
  snapshots: "MEFI_STUDIO_NO_ATTEMPT_SNAPSHOTS",
  advisory: "MEFI_STUDIO_NO_ADVISORY_CHECKS",
  shots: "MEFI_STUDIO_NO_EVIDENCE_SHOTS",
});

// The effective choices: the saved ones (a missing or odd value is the default),
// then the environment on top. `forced` names the ones the environment holds off,
// so a page can say "switched off for this launch" instead of showing a live toggle.
function prefsFrom(saved, env = {}) {
  const source = saved && typeof saved === "object" && !Array.isArray(saved) ? saved : {};
  const own = {};
  for (const key of Object.keys(DEFAULTS)) own[key] = typeof source[key] === "boolean" ? source[key] : DEFAULTS[key];
  const forced = {};
  for (const [key, name] of Object.entries(SWITCHES)) forced[key] = String(env?.[name] ?? "") === "1";
  return {
    snapshots: own.snapshots && !forced.snapshots,
    advisory: own.advisory && !forced.advisory,
    advisoryBuild: own.advisoryBuild && own.advisory && !forced.advisory,
    shots: own.shots && !forced.shots,
    saved: own,
    forced,
  };
}

// What a page may set: only the four booleans, nothing else.
function patchFrom(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Choose what to change." };
  const patch = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (!Object.hasOwn(body, key)) continue;
    if (typeof body[key] !== "boolean") return { ok: false, error: "Each choice is on or off." };
    patch[key] = body[key];
  }
  return Object.keys(patch).length ? { ok: true, patch } : { ok: false, error: "Choose what to change." };
}

module.exports = { DEFAULTS, SWITCHES, prefsFrom, patchFrom };
