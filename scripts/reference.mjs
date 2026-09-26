// Mefi's Studio AI+ — Reference engine.
//
// Gathers exact context for an idea/fix before it becomes a task:
//   code      - analyzer evidence (files, lines, snippets)
//   node tree - live sessions whose titles/keywords match
//   chats     - recent idea lines from sessions
//   pngs      - newest evidence images from tools/logs
//   web       - optional DuckDuckGo lookup (toggle, off by default)
// Everything is grouped for the reference menu; the UI decides what to show.

import { fileURLToPath } from "node:url";
import studioPaths from "./paths.cjs";
import path from "node:path";
import { isExtractionArtifact } from "./assistant.mjs";
import agentTools from "./agent-tools.cjs";

const STOPWORDS = new Set("the and for with that this from into about they them their will would should could what when where which while have has had add make use using new now out over more most some any all not but also just like work idea fix task feature build".split(/\s+/));

export function keywordsOf(text) {
  return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9_-]{3,}/g) ?? []).filter((word) => !STOPWORDS.has(word)))].slice(0, 16);
}

function score(haystack, keys) {
  const lower = haystack.toLowerCase();
  let hits = 0;
  for (const key of keys) if (lower.includes(key)) hits += 1;
  return hits;
}

export function matchSessions(sessions, text, { limit = 5 } = {}) {
  const keys = keywordsOf(text);
  return sessions
    .map((session) => ({
      session,
      score: score(`${session.title ?? ""} ${session.agent ?? ""} ${session.model?.id ?? ""}`, keys),
    }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.session.timeUpdated - a.session.timeUpdated)
    .slice(0, limit)
    .map((entry) => ({
      id: entry.session.id,
      title: entry.session.title,
      agent: entry.session.agent,
      model: entry.session.model?.id ?? "?",
      updated: entry.session.timeUpdated,
      score: entry.score,
    }));
}

export function matchChatIdeas(chatTexts, text, { limit = 6 } = {}) {
  const keys = keywordsOf(text);
  const results = [];
  for (const chat of chatTexts) {
    for (const line of String(chat.text ?? "").split("\n")) {
      const trimmed = line.trim();
      if (trimmed.length < 24 || trimmed.length > 240) continue;
      const hits = score(trimmed, keys);
      if (hits === 0) continue;
      results.push({ sessionId: chat.sessionId, at: chat.at, text: trimmed, score: hits });
    }
  }
  return results.sort((a, b) => b.score - a.score || b.at - a.at).slice(0, limit);
}

export async function webSearch(query, { limit = 5 } = {}) {
  try {
    return (await agentTools.search(String(query).slice(0, 500))).results.slice(0, limit);
  } catch {
    return [];
  }
}

// Pure assembly: main.cjs supplies the live data, tests supply fixtures.
export function referencesFor({ text, analysis, sessions = [], chats = [], pngs = [], web = [], ideas = [] }) {
  const keys = keywordsOf(text);
  const code = (analysis?.hits ?? [])
    .slice(0, 14)
    .map((hit) => ({ file: hit.file, line: hit.line, snippet: hit.snippet, keyword: hit.keyword }));
  const files = [...new Set(code.map((hit) => hit.file))].slice(0, 10);
  const pngRefs = pngs
    .slice(0, 8)
    .map((png) => ({ path: png.path ?? png, name: (png.path ?? png).split(/[\\/]/).pop() }))
    .filter((png) => score(png.name, keys) > 0);
  const ideaRefs = ideas
    .map((idea) => ({ ...idea, score: score(`${idea.title ?? ""} ${idea.detail ?? ""}`, keys) }))
    .filter((idea) => idea.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  return {
    text,
    verdict: analysis?.verdict ?? "unknown",
    coverage: analysis?.coverage ?? 0,
    code,
    files,
    sessions: matchSessions(sessions, text),
    chats: matchChatIdeas(chats, text),
    pngs: pngRefs.length ? pngRefs : pngs.slice(0, 3).map((png) => ({ path: png.path ?? png, name: (png.path ?? png).split(/[\\/]/).pop() })),
    web,
    ideas: ideaRefs,
    keywords: keys,
    gatheredAt: new Date().toISOString(),
  };
}

const IDEA_PATTERN = /\b(idea|should|could|what if|maybe we|suggest|feature|improve|would be nice|let'?s add|missing|redesign|polish)\b/i;

export function scanIdeas(chatTexts, { limit = 60 } = {}) {
  const seen = new Set();
  const ideas = [];
  for (const chat of chatTexts) {
    for (const rawLine of String(chat.text ?? "").split("\n")) {
      const line = rawLine.replace(/^[-*\d.\s]+/, "").trim();
      if (line.length < 30 || line.length > 220) continue;
      if (!IDEA_PATTERN.test(line)) continue;
      // Narration is not a proposal: progress chatter, status reports and
      // questions must not become candidate ideas — the model can only mint
      // what it is shown, and every candidate costs review budget.
      if (isExtractionArtifact(line)) continue;
      const normalized = line.toLowerCase().replace(/\s+/g, " ").slice(0, 140);
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      ideas.push({
        title: line.slice(0, 80),
        detail: line,
        source: "chat",
        sessionId: chat.sessionId,
        at: chat.at,
        tags: keywordsOf(line).slice(0, 5),
      });
      if (ideas.length >= limit) return ideas;
    }
  }
  return ideas;
}

// CLI: node scripts/reference.mjs --text "..." [--root <repo>] [--web]
async function cli() {
  const args = process.argv.slice(2);
  const textIndex = args.indexOf("--text");
  if (textIndex < 0) {
    console.error("usage: node scripts/reference.mjs --text <idea> [--root <repo>] [--web]");
    process.exit(2);
  }
  const text = args[textIndex + 1];
  const rootIndex = args.indexOf("--root");
  const studioRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const root = rootIndex >= 0 ? args[rootIndex + 1] : studioPaths.resolveStudioPaths({ studioRoot }).repoRoot;
  const { verifyIdea } = await import("./analyzer.mjs");
  const analysis = await verifyIdea(text, { root });
  const web = args.includes("--web") ? await webSearch(text) : [];
  console.log(
    JSON.stringify(
      referencesFor({
        text,
        analysis,
        sessions: [],
        chats: [],
        pngs: [],
        web,
      }),
      null,
      2
    )
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli().catch((error) => {
    console.error(error.message);
    process.exit(2);
  });
}
