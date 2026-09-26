// Mefi's Studio AI+ — where a new app from Vibe's box goes: its folder name
// and place, before anything is written. Vibe is for making an app from a
// prompt, so "New app" makes an empty project folder, starts git in it and
// opens it; the description then goes through Build it as the first request.
//
// Rules: the name must give a usable folder name; the folder lives under the
// chosen parent (by default "Mefi Apps" in the home folder); and it is never
// inside Studio's own repository (a game or app is its own project, never
// files moved into this one).
//
// Pure module: no Electron, no filesystem, no network, no clock reads.

"use strict";

const path = require("node:path");
const { containsPath } = require("./path-scope.cjs");

const LIMITS = Object.freeze({ name: 60, slug: 48, about: 600 });
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function slugOf(name) {
  return String(name ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, LIMITS.slug).replace(/-+$/g, "");
}

/**
 * The folder a new app would get, or why it cannot:
 *   { ok: true, name, slug, folder, about } | { ok: false, error }
 */
function plan({ name, about = "", parent = null, home, studioRoot = null } = {}) {
  const clean = String(name ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, LIMITS.name);
  if (!clean) return { ok: false, error: "Give the new app a name." };
  const slug = slugOf(clean);
  if (!slug || RESERVED.test(slug)) return { ok: false, error: "That name cannot be a folder name. Try letters and numbers." };
  const base = parent ? path.resolve(String(parent)) : home ? path.join(String(home), "Mefi Apps") : null;
  if (!base) return { ok: false, error: "There is no place to make the app folder." };
  const folder = path.join(base, slug);
  if (studioRoot && (containsPath(studioRoot, folder) || containsPath(folder, studioRoot))) return { ok: false, error: "A new app gets its own folder, outside Studio's own." };
  return { ok: true, name: clean, slug, folder, about: String(about ?? "").trim().slice(0, LIMITS.about) };
}

/** The starter README, so the folder says what it is from its first commit on. */
function readme({ name, about }) {
  return `# ${name}\n\n${about ? `${about}\n\n` : ""}Started in Mefi's Studio AI+ from a prompt.\n`;
}

module.exports = { LIMITS, slugOf, plan, readme };
