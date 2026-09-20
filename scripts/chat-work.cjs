// Chat admission compares the complete obligation before creating a card.
// This deliberately favors missed paraphrases over discarding distinct work:
// common wording changes may match, but partial overlap never does.
const rows = (value) => Array.isArray(value) ? value.filter((row) => row && typeof row === "object") : [];
const closed = new Set(["done", "closed", "complete", "completed", "archived", "absorbed", "dismissed", "rejected", "cancelled", "canceled"]);
const live = (item) => !closed.has(String(item?.status ?? "").toLowerCase());
const sameProject = (item, incoming) => !incoming.projectId || !item?.projectId || item.projectId === incoming.projectId;
const string = (value) => String(value ?? "").trim();
const titleKey = (value) => string(value).toLowerCase().replace(/[\u2018\u2019]/g, "'").replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();

const actionFamilies = new Map([
  ["add", "add"], ["adding", "add"], ["create", "add"], ["creating", "add"], ["implement", "add"], ["implementing", "add"], ["build", "add"], ["building", "add"],
  ["fix", "fix"], ["fixing", "fix"], ["repair", "fix"], ["repairing", "fix"], ["resolve", "fix"], ["resolving", "fix"],
  ["remove", "remove"], ["removing", "remove"], ["delete", "remove"], ["deleting", "remove"],
  ["update", "update"], ["updating", "update"], ["change", "update"], ["changing", "update"],
  ["improve", "improve"], ["improving", "improve"], ["enhance", "improve"], ["enhancing", "improve"],
  ["test", "test"], ["testing", "test"], ["verify", "test"], ["verifying", "test"],
  ["ensure", "ensure"], ["prevent", "prevent"], ["avoid", "prevent"],
]);
// Explicit words avoid general stemming, which can erase meaningful names.
const smallVariants = new Map([
  ["tasks", "task"], ["questions", "question"], ["requests", "request"], ["duplicates", "duplicate"],
  ["buttons", "button"], ["tabs", "tab"], ["drafts", "draft"], ["panels", "panel"], ["dialogs", "dialog"],
  ["errors", "error"], ["crashes", "crash"], ["issues", "issue"], ["bugs", "bug"],
  ["colour", "color"], ["colours", "color"], ["colors", "color"], ["max", "maximum"], ["min", "minimum"],
]);

function briefOf(item) {
  let value = string(item?.prompt) || string(item?.title);
  // Host-added focus context is provenance, not another user requirement.
  value = value.replace(/\n\nThe user pointed the assistant at (?:task|session|todo) "[^\n]*" \(id: [^\n]*\) while asking for this\.$/, "");
  const resolved = value.match(/^Work on "([^"\n]+)"\. Queued from the assistant chat — the user (?:said|confirmed with) "[^\n]*"\.$/);
  return resolved ? resolved[1] : value;
}

function shape(value) {
  let text = string(value).normalize("NFKC").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"');
  // Paths and numeric scope stay ordered, and paths retain their case. A
  // filename is not ordinary vocabulary to be reordered or stemmed.
  const paths = text.match(/(?:[A-Za-z]:)?(?:[\w.-]+[\\/])+[\w.-]+|\b[\w-]+\.[A-Za-z][\w-]*\b/g) ?? [];
  text = text.toLowerCase().replace(/\b(?:don't|dont)\b/g, "do not").replace(/\b(?:can't|cant|cannot)\b/g, "can not").replace(/\bwon't\b/g, "will not").replace(/\b([a-z]+)'s\b/g, "$1");
  text = text.replace(/^(?:(?:please|pls|hey|hi|ok|okay|just|can you|could you|would you|will you|i want you to|i need you to)\s+)+/, "").replace(/\s+please[.!?]*$/, "");
  text = text.replace(/^work on\s+"([^"\n]+)"[.!?]*$/, "$1").replace(/^make sure\b/, "ensure");
  const words = text.match(/[\p{L}\p{N}_]+(?:[./\\:-][\p{L}\p{N}_-]+)*|[<>!=]=?/gu) ?? [];
  // A trailing A (or "module A to B") can name a scope, not an article.
  const significant = words.filter((word, index) => word !== "the" && (!["a", "an"].includes(word)
    || !words[index + 1] || /^(?:to|from|for|with|without|in|on|and|or)$/.test(words[index + 1])));
  const tokens = significant.map((word, index) =>
    (index === 0 ? actionFamilies.get(word) : null) ?? smallVariants.get(word) ?? word);
  const action = actionFamilies.get(significant[0] ?? "") ?? null;
  // Relation/order words protect who acts on what (and source/destination).
  // Negative or compound instructions also require the original word order.
  const ordered = paths.length > 0 || words.slice(1).some((word) => actionFamilies.has(word) || /ing$/.test(word)) || words.some((word) => /\d/.test(word)
    || /^(?:to|from|for|as|with|without|on|in|into|by|before|after|above|below|over|under|left|right|up|down|not|never|no|only|except|unless|instead|and|or|then)$/.test(word));
  return { tokens, action, ordered, paths };
}

function equalBrief(left, right) {
  const a = shape(briefOf(left)), b = shape(briefOf(right));
  if (!a.tokens.length || !b.tokens.length || JSON.stringify(a.paths) !== JSON.stringify(b.paths)) return false;
  if (a.tokens.join(" ") === b.tokens.join(" ")) return true;
  // Require complete coverage and enough specific language before permitting
  // simple noun-phrase reorderings such as "fix login button alignment".
  if (!a.action || a.action !== b.action || a.ordered || b.ordered || a.tokens.length < 4 || b.tokens.length < 4) return false;
  return [...a.tokens].sort().join(" ") === [...b.tokens].sort().join(" ");
}

function scopeOf(item) {
  const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : typeof value === "string" ? value.trim().replace(/\s+/g, " ") : value;
  const result = {};
  for (const field of ["file", "files", "requirements", "constraints", "acceptance", "acceptanceCriteria", "scope", "remaining", "description", "details"]) {
    const value = item?.[field];
    if (value != null && value !== "" && !(Array.isArray(value) && !value.length)) result[field] = canonical(value);
  }
  return result;
}

function coversScope(existing, incoming) {
  const saved = scopeOf(existing);
  return Object.entries(scopeOf(incoming)).every(([field, value]) => JSON.stringify(saved[field]) === JSON.stringify(value));
}

function descendants(item) {
  const result = [], seen = new Set();
  const visit = (row) => {
    if (!row || seen.has(row)) return;
    seen.add(row);
    result.push(row);
    for (const member of rows(row.members)) visit(member);
  };
  visit(item);
  return result;
}

function targetMatches(item, target, kind) {
  if (!target?.kind || !target?.id) return false;
  const id = String(target.id).replace(/^task:/, "");
  if (target.kind === "task" && kind === "task" && (item.id === target.id || item.id === id)) return true;
  if (target.kind === "request" && kind === "request" && item.id === target.id) return true;
  return item.target?.kind === target.kind && item.target.id === target.id;
}

function findExistingChatWork({ tasks = [], requests = [], jobs = [] } = {}, incoming = {}) {
  const candidates = [];
  for (const [kind, entries] of [["task", tasks], ["request", requests]]) {
    for (const item of rows(entries)) {
      if (!live(item) || !sameProject(item, incoming)) continue;
      const members = descendants(item).filter((member) => live(member) && sameProject(member, incoming));
      candidates.push({ kind, item, members });
    }
  }
  // A worker's saved reference can outlive request promotion/removal. Keep
  // settlement as live ownership even when the process has already finished.
  for (const item of rows(jobs)) {
    if ((item.finished && !item.settlementPending) || !sameProject(item, incoming) || !sameProject(item.ref, incoming)) continue;
    const ref = item.ref && typeof item.ref === "object" ? item.ref : item;
    candidates.push({ kind: "worker", item, members: descendants(ref).filter((member) => sameProject(member, incoming)) });
  }
  const unique = (matches, reportAmbiguous = false) => {
    // Promotion leaves the inbox representation briefly, and worker refs may
    // survive that transition too. These are one obligation, not an ambiguous
    // choice between unrelated tasks with the same display title.
    const rank = { task: 0, worker: 1, request: 2 };
    const distinct = [];
    for (const candidate of [...matches].sort((a, b) => rank[a.kind] - rank[b.kind])) {
      if (distinct.some((other) => other.item === candidate.item
        || (candidate.kind === "worker" && other.kind === "task" && candidate.item.taskId === other.item.id)
        || (other.kind === "worker" && candidate.kind === "task" && other.item.taskId === candidate.item.id)
        || candidate.members.some((member) => other.members.some((saved) =>
          (member.id && member.id === saved.id) || ((coversScope(member, saved) || coversScope(saved, member)) && equalBrief(member, saved)))))) continue;
      distinct.push(candidate);
    }
    if (distinct.length === 1) return { kind: distinct[0].kind, item: distinct[0].item };
    return reportAmbiguous && distinct.length > 1 ? { kind: "ambiguous", items: distinct.map(({ kind, item }) => ({ kind, item })) } : null;
  };
  if (incoming.existingTarget) {
    const matches = candidates.filter((candidate) => candidate.members.some((member) => targetMatches(member, incoming.existingTarget, candidate.kind))
      || (candidate.kind === "worker" && incoming.existingTarget.kind === "task" && candidate.item.taskId === String(incoming.existingTarget.id).replace(/^task:/, ""))
      || (candidate.kind === "worker" && incoming.existingTarget.kind === "session" && candidate.item.sessionId === incoming.existingTarget.id));
    return unique(matches);
  }
  if (string(incoming.resolvedTitle)) {
    const key = titleKey(incoming.resolvedTitle);
    return unique(candidates.map((candidate) => ({ ...candidate, members: candidate.members.filter((member) => titleKey(member.title) === key) }))
      .filter((candidate) => candidate.members.length), true);
  }
  for (const candidate of candidates) {
    if (candidate.members.some((member) => coversScope(member, incoming) && equalBrief(member, incoming))) {
      return { kind: candidate.kind, item: candidate.item };
    }
  }
  return null;
}

module.exports = { findExistingChatWork };
