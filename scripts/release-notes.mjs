// Mefi's Studio AI+ — writes assets/whats-new.json from CHANGELOG.md.
//
//   node scripts/release-notes.mjs             write assets/whats-new.json
//   node scripts/release-notes.mjs --check     exit 1 when the file is stale (CI)
//   node scripts/release-notes.mjs --print     show it, write nothing
//   --root <folder>                            another checkout (tests, previews)
//
// The app says what changed in plain words, once, after an update
// (scripts/whats-new.cjs, main.cjs "What's new"). Those words come from the
// changelog's own version sections, so nobody writes them twice:
//
//   - Only dated sections ("## [0.5.0] - 2026-10-01") count. [Unreleased] is
//     not a version yet, and the newest VERSION_CAP versions that have any
//     notes are kept.
//   - A bullet's plain sentence is its bold lead when that lead is a
//     sentence ("- **Ctrl + and Ctrl - change the interface scale.** ..."). A
//     bold label ("- **Trace** (Live, beside Activity): Studio's logs...")
//     falls back to the bullet's first sentence. A bullet with no bold lead
//     is written for maintainers and is left out.
//   - <!-- notes: Studio starts a little quicker. --> inside a bullet says
//     the sentence itself; <!-- internal --> (or an "Internal:" / "Tests:"
//     lead, or a "### Internal" heading above it) keeps a bullet out.
//   - At most NOTE_CAP sentences per version, in changelog order.
//
// scripts/package-portable.mjs runs this before it copies assets/, so every
// package carries notes for its own version. `--check` is for CI: it fails
// when the committed file no longer matches the changelog's released
// sections (tests/release_notes.test.mjs runs it against the real repository,
// so a version cut without regenerating fails the gate).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const { NOTE_CAP, SENTENCE_MAX, VERSION_CAP, cleanVersion, clip, compareVersions, normalizeTable } = require("./whats-new.cjs");

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const CHANGELOG_FILE = "CHANGELOG.md";
export const NOTES_FILE = path.join("assets", "whats-new.json");

const HEADING = /^##\s+\[([^\]]+)\](?:\s*-\s*(\S+))?\s*$/;
const SUBHEADING = /^###\s+(.+?)\s*$/;
const INTERNAL_HEADING = /^(?:internal|tests?|testing|developers?|for (?:contributors|developers)|tooling|maintenance|chores?)$/i;
const INTERNAL_LEAD = /^(?:\*\*)?\s*(?:\[internal\]|\(internal\)|internal\b|tests?\b|developers?\b|ci\b)\s*(?:\*\*)?\s*:/i;
const INTERNAL_MARK = /<!--\s*internal\s*-->/i;
const NOTES_MARK = /<!--\s*notes:\s*([\s\S]*?)\s*-->/i;

/** The version sections of a changelog: [{ version, date, bullets: [{ text, sub }] }], top to bottom. */
export function parseChangelog(text) {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n");
  const sections = [];
  let section = null;
  let sub = "";
  let bullet = null;
  const close = () => { if (bullet && section) section.bullets.push({ text: bullet.join(" ").replace(/\s+/g, " ").trim(), sub }); bullet = null; };
  for (const line of lines) {
    const head = HEADING.exec(line);
    if (head) {
      close();
      section = { name: head[1].trim(), version: cleanVersion(head[1]), date: head[2] ?? null, bullets: [] };
      sections.push(section);
      sub = "";
      continue;
    }
    if (/^#{1,2}\s/.test(line)) { close(); section = null; continue; }
    if (!section) continue;
    const under = SUBHEADING.exec(line);
    if (under) { close(); sub = under[1]; continue; }
    if (/^- /.test(line)) { close(); bullet = [line.slice(2)]; continue; }
    if (bullet && /^\s+\S/.test(line)) { bullet.push(line.trim()); continue; }
    if (!line.trim()) continue;
    close();
  }
  close();
  return sections;
}

// Markdown out of a sentence: links keep their words, code and emphasis lose
// their marks, comments go.
function plain(markdown) {
  return String(markdown ?? "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=$|[\s).,;:!?])/g, "$1$2")
    .replace(/\s+/g, " ")
    .trim();
}

// The first sentence of some plain text: up to a full stop that ends a word,
// or the whole text when it has none.
function firstSentence(text) {
  const match = /^(.+?[.!?])(?=\s+[A-Z\u201c"(]|\s*$)/.exec(text);
  return (match ? match[1] : text).trim();
}

// A sentence that is too long is cut where a clause ends rather than in the
// middle of a thought: at the last ", ", "; ", ": " or " (" that keeps at
// least 60 characters, with a full stop. No such place, and it ends in "...".
function shorten(sentence, max = SENTENCE_MAX) {
  if (sentence.length <= max) return sentence;
  const window = sentence.slice(0, max - 1);
  const cut = Math.max(window.lastIndexOf(", "), window.lastIndexOf("; "), window.lastIndexOf(" \u2014 "), window.lastIndexOf(" ("));
  return cut >= 60 ? `${window.slice(0, cut).replace(/[,;:\s]+$/, "")}.` : clip(sentence, max);
}

// What only a maintainer needs: file names, folders and commands. A sentence
// that names one is not for the person using the app.
const TECHNICAL = /\b(?:docs|scripts|renderer|tests|tools)\/|\b[\w-]+\.(?:mjs|cjs|js|json|md|css|html|ps1)\b|\bnpm (?:run|test)\b|\bTESTRUNS\b/;

/** Why a bullet says nothing to the person using the app, or null. */
export function skipReason(bullet) {
  if (INTERNAL_HEADING.test(String(bullet?.sub ?? "").trim())) return "internal heading";
  if (INTERNAL_MARK.test(bullet?.text ?? "")) return "marked internal";
  if (INTERNAL_LEAD.test(String(bullet?.text ?? "").trim())) return "internal lead";
  return null;
}

/**
 * The one plain sentence a bullet gives, or null when it gives none: its
 * <!-- notes: --> sentence, else its bold lead when that ends like a
 * sentence, else (a bold label such as "**Trace** (Live): ...") the label
 * joined to the bullet's first sentence. No bold lead, no sentence.
 */
export function sentenceOf(bullet) {
  if (!bullet || skipReason(bullet)) return null;
  const said = NOTES_MARK.exec(bullet.text);
  if (said) {
    const custom = plain(said[1]);
    return /^(?:none|skip)$/i.test(custom) || !custom ? null : shorten(custom);
  }
  const bold = /^\*\*(.+?)\*\*([\s\S]*)$/.exec(bullet.text);
  if (!bold) return null;
  const lead = plain(bold[1]);
  let sentence = lead;
  if (!/[.!?]$/.test(lead)) {
    const rest = plain(bold[2]).replace(/^[\s:\u2014\u2013-]+/, "");
    if (!rest) return null;
    const label = lead.replace(/[.:!?]+$/, "");
    sentence = firstSentence(/^[A-Z\u201c"]/.test(rest) ? `${label}: ${firstSentence(rest)}` : `${label}${/^[,;.)]/.test(rest) ? "" : " "}${rest}`);
  }
  sentence = shorten(sentence);
  const words = sentence.split(/\s+/).filter(Boolean);
  return words.length >= 3 && sentence.length >= 12 && !TECHNICAL.test(sentence) ? sentence : null;
}

/** { "<version>": [sentence, ...] } from a changelog, newest version first. */
export function buildTable(changelog, { versions = VERSION_CAP, cap = NOTE_CAP } = {}) {
  const found = new Map();
  for (const section of parseChangelog(changelog)) {
    if (!section.version || !section.date || found.has(section.version)) continue;
    const notes = [...new Set(section.bullets.map(sentenceOf).filter(Boolean))].slice(0, cap);
    if (notes.length) found.set(section.version, notes);
  }
  const sorted = [...found.entries()].sort((a, b) => compareVersions(b[0], a[0])).slice(0, versions);
  return Object.fromEntries(sorted);
}

/** The file's bytes for a table: two-space JSON, a newline at the end. */
export const serialize = (table) => `${JSON.stringify(table, null, 2)}\n`;

async function readOr(file, fallback = null) {
  try { return await readFile(file, "utf8"); } catch (error) { if (error?.code === "ENOENT") return fallback; throw error; }
}

/** Write the table for a checkout. Answers { path, table, changed, versions }. */
export async function generate({ root = ROOT } = {}) {
  const changelog = await readOr(path.join(root, CHANGELOG_FILE));
  if (changelog === null) throw new Error(`${CHANGELOG_FILE} not found in ${root}`);
  const table = buildTable(changelog);
  const file = path.join(root, NOTES_FILE);
  const text = serialize(table);
  const previous = await readOr(file);
  const changed = (previous ?? "").replace(/\r\n/g, "\n") !== text;
  if (changed) {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, text, "utf8");
  }
  return { path: file, table, changed, versions: Object.keys(table) };
}

/**
 * Whether the committed file still matches the changelog: { ok, path, stale }
 * where `stale` names each version that differs, is missing or is left over.
 */
export async function check({ root = ROOT } = {}) {
  const changelog = await readOr(path.join(root, CHANGELOG_FILE));
  if (changelog === null) throw new Error(`${CHANGELOG_FILE} not found in ${root}`);
  const wanted = buildTable(changelog);
  const file = path.join(root, NOTES_FILE);
  const raw = await readOr(file);
  let saved = null;
  try { saved = raw === null ? null : JSON.parse(raw.replace(/^﻿/, "")); } catch { saved = null; }
  const have = normalizeTable(saved);
  const stale = [];
  for (const version of new Set([...Object.keys(wanted), ...Object.keys(have)])) {
    if (JSON.stringify(wanted[version] ?? null) !== JSON.stringify(have[version] ?? null)) stale.push(version);
  }
  const exact = raw !== null && raw.replace(/\r\n/g, "\n") === serialize(wanted);
  return { ok: raw !== null && saved !== null && stale.length === 0 && exact, path: file, missing: raw === null, unreadable: raw !== null && saved === null, stale };
}

async function cli(argv) {
  const at = argv.indexOf("--root");
  const root = at >= 0 && argv[at + 1] ? path.resolve(argv[at + 1]) : ROOT;
  if (argv.includes("--check")) {
    const result = await check({ root });
    if (result.ok) { console.log(`${path.relative(root, result.path)} matches ${CHANGELOG_FILE}`); return 0; }
    const why = result.missing ? "is missing" : result.unreadable ? "is not readable JSON" : result.stale.length ? `is out of date for ${result.stale.join(", ")}` : "differs from what the generator writes";
    console.error(`${path.relative(root, result.path)} ${why}. Run: node scripts/release-notes.mjs`);
    return 1;
  }
  if (argv.includes("--print")) { process.stdout.write(serialize(buildTable(await readFile(path.join(root, CHANGELOG_FILE), "utf8")))); return 0; }
  const result = await generate({ root });
  console.log(`${path.relative(root, result.path)}: ${result.versions.length ? result.versions.join(", ") : "no versions with notes"}${result.changed ? " (updated)" : " (already current)"}`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then((code) => { process.exitCode = code; }).catch((error) => { console.error(error.message); process.exitCode = 2; });
}
