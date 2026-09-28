"use strict";

// Working together across PCs: live file claims in a Void Engine cowork room.
// Before a builder edits files, main claims them in the room linked to the
// project's GitHub repository (main.cjs "Cowork claims"); every PC in the room
// hears each change within a second, and a pick whose files another PC holds
// waits instead of editing them at the same time. Pure: the path rules and
// overlap test mirror the hub's own (void-engine-bot src/claims/paths.mjs, as
// docs/protocol.md describes them), so a claim Studio sends is one the hub
// accepts, and Studio reads a lease the way the hub means it.
// Guarded by tests/cowork.test.mjs.
const path = require("node:path");

const MACHINE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_PATHS = 50;
const ONE_LINE = /^[^\x00-\x1f\x7f]*$/;
const SNOWFLAKE = /^\d{17,20}$/;
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;

// A claim path as the hub keeps it, or null: repo-relative POSIX, an exact
// file or `dir/**`. Backslashes become `/`, `.` and empty segments go; an
// absolute path, a drive letter, `..`, control characters, surrounding
// spaces, a trailing `/`, a bare `**` and any other wildcard are refused.
function claimPath(raw) {
  if (typeof raw !== "string" || !raw || raw.length > 200 || raw !== raw.trim() || !ONE_LINE.test(raw)) return null;
  const slashed = raw.replace(/\\/g, "/");
  if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed) || slashed.endsWith("/")) return null;
  const segments = slashed.split("/").filter((segment) => segment && segment !== ".");
  if (!segments.length || segments.includes("..")) return null;
  const last = segments[segments.length - 1];
  const tree = last === "**";
  if (tree && segments.length === 1) return null;
  if ((tree ? segments.slice(0, -1) : segments).some((segment) => /[*?]/.test(segment))) return null;
  return segments.join("/");
}

// Whether two claim paths touch: case folded, whole segments, and `dir/**`
// covers the folder, everything under it and a file named `dir`.
function overlaps(a, b) {
  const split = (value) => {
    const segments = String(value).toLowerCase().split("/");
    const tree = segments[segments.length - 1] === "**";
    return { segments: tree ? segments.slice(0, -1) : segments, tree };
  };
  const left = split(a), right = split(b);
  const prefix = (short, long) => short.every((segment, index) => long[index] === segment);
  if (left.tree && prefix(left.segments, right.segments)) return true;
  if (right.tree && prefix(right.segments, left.segments)) return true;
  return !left.tree && !right.tree && left.segments.length === right.segments.length && prefix(left.segments, right.segments);
}

const str = (value, max) => (typeof value === "string" && value.length <= max && ONE_LINE.test(value) ? value : null);

// A lease from the hub, kept only when it has the protocol's shape.
function lease(value) {
  if (!value || typeof value !== "object") return null;
  if (!OPAQUE_ID.test(String(value.leaseId)) || !SNOWFLAKE.test(String(value.memberId)) || !MACHINE_ID.test(String(value.machineId))) return null;
  const paths = Array.isArray(value.paths) ? value.paths.map(claimPath).filter(Boolean).slice(0, MAX_PATHS) : [];
  if (!Number.isFinite(value.expiresAt)) return null;
  return {
    leaseId: String(value.leaseId), memberId: String(value.memberId), machineId: String(value.machineId),
    runId: str(value.runId, 64), title: str(value.title, 200), branch: str(value.branch, 200),
    paths, exclusive: value.exclusive === true, fence: Number.isInteger(value.fence) ? value.fence : 0,
    at: Number.isFinite(value.at) ? value.at : null, expiresAt: value.expiresAt,
  };
}

// Another PC's lease: another member, or this member on another machine.
const others = (leases, self) => (Array.isArray(leases) ? leases : []).filter((item) => item && (item.memberId !== self?.memberId || item.machineId !== self?.machineId));

// The files another PC holds exclusively, as the in-flight jobs the
// dispatcher already waits for (assistant.mjs claimWork reads job.files).
// `dir/**` is passed as the folder, and a lease that has expired on the
// hub's clock (a frame that never came) is left out.
function heldElsewhere(leases, self, now = Date.now()) {
  return others(leases, self).filter((item) => item.exclusive && item.paths.length && item.expiresAt > now).map((item) => ({
    title: `${item.title || "Work"} (on another PC)`,
    files: item.paths.map((value) => (value.endsWith("/**") ? value.slice(0, -3) : value)),
    remote: true,
    leaseId: item.leaseId,
  }));
}

// A job's files as claim paths: only those inside the project, relative to
// it; anything outside, or that the hub would refuse, is left out.
function claimPathsFor(root, files) {
  const out = [];
  for (const file of Array.isArray(files) ? files : []) {
    if (typeof file !== "string" || !file) continue;
    const absolute = path.isAbsolute(file) ? file : path.resolve(root, file);
    const relative = path.relative(root, absolute);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) continue;
    const value = claimPath(relative);
    if (value && !out.includes(value)) out.push(value);
    if (out.length >= MAX_PATHS) break;
  }
  return out;
}

// Who holds what a claim collided with, in words for the task's hold note.
function conflictNote(conflicts) {
  const rows = (Array.isArray(conflicts) ? conflicts : []).slice(0, 3).map((item) => {
    const files = (Array.isArray(item?.overlapping) ? item.overlapping : []).slice(0, 3).join(", ");
    const title = str(item?.title, 200);
    return `${title ? `"${title}"` : "another PC's work"}${files ? ` (${files})` : ""}`;
  });
  return rows.length ? `Another PC is working on the same files: ${rows.join("; ")}. This waits until it lets go.` : "Another PC is working on the same files. This waits until it lets go.";
}

// settings.cowork: which cowork room works on which repository, and this
// PC's machine id (made once, never shared).
function normalizeSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const rooms = {};
  for (const [repo, roomId] of Object.entries(source.rooms && typeof source.rooms === "object" ? source.rooms : {})) {
    if (REPO.test(repo) && OPAQUE_ID.test(String(roomId))) rooms[repo.toLowerCase()] = String(roomId);
  }
  return { rooms, machineId: MACHINE_ID.test(String(source.machineId ?? "")) ? String(source.machineId) : null };
}

module.exports = { MACHINE_ID, MAX_PATHS, claimPath, overlaps, lease, others, heldElsewhere, claimPathsFor, conflictNote, normalizeSettings };
