// Mefi's Studio AI+ — agent issues: the one shape an agent uses to say "this
// needs a decision", and the rules that turn it into either an answer the
// assistant gives by itself or a card in Ask.
//
// Before this module a worker had exactly two ways to end: done, or failed.
// Anything in between — the brief is vaguer than the code, a check fails for a
// reason only a person can weigh, the change wants a file outside its scope —
// came out as a silent failure and reached the user as "has failed 1 times".
// An issue carries the task it belongs to, what the agent was doing, the
// evidence it saw, and options that are real actions on that task, so the
// question the user answers is about the work rather than about the retry.
//
// Pure module: no Electron, no filesystem, no network. Time is injectable: a
// function that stamps a time takes `now`, falling back to the clock only when
// the caller passes none. Everything here is data-in, data-out so the host can
// run it inside a board transaction and the tests can run it with no host at all.

"use strict";

// The worker protocol line, anchored at the start of a line exactly like the
// handoff and verdict marks: a run that quotes the protocol back in prose must
// not be able to open a card the user has to answer.
const ISSUE_MARK = "MEFI_ASK:";
const ISSUE_MAX_PER_RUN = 3;
const TITLE_MAX = 140;
const DETAIL_MAX = 600;
const EVIDENCE_LINES = 4;

const ANSI = /\u001b\[[0-9;]*m/g;
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g;

function clean(value, limit) {
  return String(value ?? "").replace(ANSI, "").replace(CONTROL, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

// ---- the kinds --------------------------------------------------------------
// A kind is the vocabulary an agent is given for "what sort of decision is
// this". `ask: "always"` marks the two nobody may automate away: granting reach
// the agent was not given, and accepting a risk. The user owns both, whatever a
// brain map says, so the policy below cannot configure them into silence.

const ISSUE_KINDS = {
  scope: {
    label: "a scope decision",
    severity: "decision",
    ask: "policy",
    headline: (context) => `${context.subject} is bigger than its brief`,
    lead: "The agent found work the brief does not cover.",
    options: ["narrow", "split", "replan", "hold"],
    recommend: "narrow",
  },
  blocked: {
    label: "a blocker",
    severity: "blocker",
    ask: "policy",
    headline: (context) => `${context.subject} is blocked`,
    lead: "The agent cannot get past something it does not own.",
    options: ["retry", "instruct", "replan", "hold"],
    recommend: "retry",
    autoAnswer: "retry",
  },
  permission: {
    label: "reach it was not given",
    severity: "blocker",
    ask: "always",
    headline: (context) => `${context.subject} wants reach it was not given`,
    lead: "Granting this widens what the agent may touch on this task only.",
    options: ["grant", "deny", "hold"],
    recommend: "deny",
  },
  "check-failed": {
    label: "a failing check",
    severity: "decision",
    ask: "policy",
    headline: (context) => `A check fails on ${context.subject}`,
    lead: "The agent ran a named check and it came back red.",
    options: ["retry", "retry-deep", "replan", "hold"],
    recommend: "retry",
    autoAnswer: "retry",
  },
  conflict: {
    label: "two ways to do it",
    severity: "decision",
    ask: "policy",
    headline: (context) => `Two ways to finish ${context.subject}`,
    lead: "The agent found instructions that pull in different directions.",
    options: ["instruct", "replan", "hold"],
    recommend: "instruct",
  },
  risk: {
    label: "a risky change",
    severity: "decision",
    ask: "always",
    headline: (context) => `${context.subject} needs a risky change`,
    lead: "The agent stopped ahead of something it cannot undo.",
    options: ["proceed", "narrow", "hold"],
    recommend: "hold",
  },
  capability: {
    label: "a model that is out of its depth",
    severity: "decision",
    ask: "policy",
    headline: (context) => `${context.subject} is past this model`,
    lead: "The agent reports the work is beyond the model or budget it was given.",
    options: ["retry-deep", "split", "hold"],
    recommend: "retry-deep",
  },
  missing: {
    label: "something missing",
    severity: "blocker",
    ask: "policy",
    headline: (context) => `${context.subject} needs something that is not here`,
    lead: "A file, key or tool the work depends on does not exist yet.",
    options: ["instruct", "split", "hold"],
    recommend: "instruct",
  },
  verify: {
    label: "no evidence",
    severity: "decision",
    ask: "policy",
    headline: (context) => `${context.subject} cannot be proven done`,
    lead: "The agent believes it finished but has nothing that shows it.",
    options: ["retry", "instruct", "hold"],
    recommend: "retry",
    autoAnswer: "retry",
  },
  // Not a decision about the work at all: the leftover is the owner's to do.
  // Splitting it out only made a card whose worker could ask the same again.
  owner: {
    label: "something only you can do",
    severity: "decision",
    ask: "policy",
    headline: (context) => `${context.subject} needs something only you can do`,
    lead: "The agent finished what it can; the rest is yours (the board, Studio's task store, another session's files).",
    options: ["acknowledge", "instruct", "hold"],
    recommend: "acknowledge",
  },
  // Raised by the host, not by a worker: a run that ended without the verdict.
  "run-failed": {
    label: "a run that stopped",
    severity: "decision",
    ask: "policy",
    headline: (context) => `${context.subject} stopped without finishing`,
    lead: "The worker ended without reporting done.",
    options: ["retry", "retry-deep", "replan", "hold"],
    recommend: "retry",
    autoAnswer: "retry",
  },
};

const ISSUE_KIND_IDS = Object.keys(ISSUE_KINDS);
// Kinds the user always answers: no brain map may automate a grant or a risk.
const ALWAYS_ASK = new Set(ISSUE_KIND_IDS.filter((kind) => ISSUE_KINDS[kind].ask === "always"));
// Kinds an assistant may settle by itself when the map allows it.
const AUTO_ANSWERABLE = new Set(ISSUE_KIND_IDS.filter((kind) => ISSUE_KINDS[kind].autoAnswer));

// ---- the options ------------------------------------------------------------
// Every option is an action the host can actually carry out on the task, so an
// answer changes the board rather than only the thread. `verb` is what
// main.cjs's issue action performs; `text` asks for one line from the user.

const ISSUE_OPTIONS = {
  narrow: {
    label: "Keep to the brief",
    description: "The extra work stays out; the agent finishes what was asked and says what it left.",
    verb: "narrow",
  },
  split: {
    label: "Split the extra work out",
    description: "This task keeps its brief; the rest becomes its own card on the board.",
    verb: "split",
  },
  replan: {
    label: "Re-plan this task",
    description: "Send it back to planning with what the agent found, then build from the new plan.",
    verb: "replan",
  },
  retry: {
    label: "Try again",
    description: "Re-arm the task with this decision written on it for the next worker.",
    verb: "retry",
  },
  "retry-deep": {
    label: "Try again with a heavier model",
    description: "The next dispatch is routed as deep work, so a stronger model is picked for it.",
    verb: "retry-deep",
  },
  instruct: {
    label: "Answer it in one line",
    description: "Your sentence is written onto the task and the next worker reads it first.",
    verb: "instruct",
    text: true,
  },
  grant: {
    label: "Grant it for this task",
    description: "The reach is recorded on this task only; other work is unaffected.",
    verb: "grant",
  },
  deny: {
    label: "Keep it out of scope",
    description: "The agent works inside what it already has and reports the rest.",
    verb: "narrow",
  },
  proceed: {
    label: "Go ahead",
    description: "Your approval is written on the task; the agent may make the risky change.",
    verb: "proceed",
  },
  acknowledge: {
    label: "I'll take care of it",
    description: "Recorded on the task; no new card is made and nothing is re-armed.",
    verb: "acknowledge",
  },
  hold: {
    label: "Leave it for review",
    description: "Nothing changes; the task keeps this note and waits for you.",
    verb: "hold",
    dismiss: true,
  },
};

// ---- parsing ----------------------------------------------------------------

/**
 * Read one line of a run's output as an issue.
 *
 * Two spellings, both anchored to the mark:
 *   MEFI_ASK: scope :: title :: detail
 *   MEFI_ASK: {"kind":"scope","title":"…","detail":"…","evidence":["…"]}
 * An unknown or missing kind reads as `conflict` — the neutral "someone decide"
 * kind — rather than being dropped, because an agent that asked deserves to be
 * heard even when it spelled the vocabulary wrong.
 */
function parseIssueLine(line) {
  const text = String(line ?? "").replace(ANSI, "").trim();
  if (!text.startsWith(ISSUE_MARK)) return null;
  const body = text.slice(ISSUE_MARK.length).trim();
  if (!body) return null;
  if (body.startsWith("{")) {
    let parsed = null;
    try { parsed = JSON.parse(body); } catch { parsed = null; }
    if (parsed && typeof parsed === "object") return normalizeIssue({ ...parsed, source: "worker" });
    return null;
  }
  const parts = body.split("::").map((part) => part.trim());
  const first = parts[0] ?? "";
  const kind = ISSUE_KIND_IDS.includes(first.toLowerCase()) ? first.toLowerCase() : null;
  const rest = kind ? parts.slice(1) : parts;
  const title = rest[0] ?? "";
  if (!title) return null;
  return normalizeIssue({ kind: kind ?? "conflict", title, detail: rest.slice(1).join(" · "), source: "worker" });
}

// ---- questions for the owner ------------------------------------------------
// Workers kept filing "Will you correct the stored acceptance?" as a scope
// ask. It is not a decision about the work: nothing a worker can build answers
// it, so Split made a card whose worker re-verified and asked it again. A
// question put TO the owner, or one naming a lane only the owner may touch,
// is filed as `owner` instead.
const OWNER_QUESTION = [
  /^(?:["'“‘`]\s*)?(?:will|would|can|could)\s+you\b/i,
  // "Should the owner land …". Studio and the host are this repo's own code
  // too ("Should the host clamp it?" is a question about the work), so they
  // count only when the ask is about Studio's stored record: "May Studio's
  // stored acceptance be corrected".
  /^(?:["'“‘`]\s*)?(?:should|may|can|could|will|would|must)\s+(?:the\s+)?owner\b/i,
  /^(?:["'“‘`]\s*)?(?:should|may|can|could|will|would|must)\s+(?:the\s+)?(?:studio|host)(?:['’]s)?\s+(?:own\s+)?(?:task[-\s]store|stored|board)\b/i,
];
const OWNER_LANE = [
  /\bowner[-\s](?:only|side)\b/i,
  /\bonly\s+the\s+owner\b/i,
  /\btask[-\s]store\b/i,
  // Negated only: "workers can rewrite it" is a statement about the work.
  /\bworkers?\s+(?:(?:may|must|can|should)\s+not|cannot|can['’]t|mustn['’]t|(?:is|are)\s+(?:not\s+allowed|forbidden|barred)\s+(?:to|from))\s+(?:\w+\s+){0,2}?(?:re)?(?:writ(?:e|ing)|edit(?:ing)?|mutat(?:e|ing)|chang(?:e|ing)|touch(?:ing)?|clos(?:e|ing)|flip(?:ping)?)\b/i,
  // Moving a named card on the live board is the owner's move.
  /\b(?:flip|close|archive|retire|sweep)\b[^.;?!]{0,60}\btask_[a-z0-9_]{8,}/i,
  // A named card's stored acceptance lives in Studio's task store.
  /\btask_[a-z0-9_]{8,}\b[^.;?!]{0,40}\bstored\s+(?:\w+\s+)?acceptance\b|\bstored\s+(?:\w+\s+)?acceptance\b[^.;?!]{0,40}\btask_[a-z0-9_]{8,}/i,
];
// Kinds a worker files an owner question under. A permission issue that names
// its permission is a real grant and stays one; a risk is never moved.
const OWNER_FROM = new Set(["scope", "missing", "conflict", "capability", "blocked"]);

/** Whether an ask is really something only the owner can do. */
function ownerDirected(title, detail = null) {
  const ask = clean(title, TITLE_MAX);
  const text = `${ask} ${clean(detail, DETAIL_MAX)}`;
  return OWNER_QUESTION.some((pattern) => pattern.test(ask)) || OWNER_LANE.some((pattern) => pattern.test(text));
}

function ownerKindFor(kind, title, detail, permission) {
  const movable = OWNER_FROM.has(kind) || (kind === "permission" && !permission);
  return movable && ownerDirected(title, detail) ? "owner" : kind;
}

// How deep a task sits in a split chain: its own splitDepth, or, for a chain
// split before that was recorded, its leading "Follow-up N:" levels — counted
// the way main.cjs's split counts them.
function splitDepthOf(raw) {
  const own = Number(raw.splitDepth);
  if (Number.isInteger(own) && own > 0) return Math.min(own, 20);
  const lead = /^(?:Follow-up(?: \d+)?:\s*)+/i.exec(String(raw.taskTitle ?? ""))?.[0] ?? "";
  return Math.min(20, [...lead.matchAll(/Follow-up(?: (\d+))?:/gi)].reduce((sum, match) => sum + (Number(match[1]) || 1), 0));
}

/** Bound, clean and complete an issue from any source. */
function normalizeIssue(raw = {}, { now = null } = {}) {
  const title = clean(raw.title, TITLE_MAX);
  if (!title) return null;
  const detail = clean(raw.detail, DETAIL_MAX) || null;
  const permission = clean(raw.permission, 60) || null;
  const kind = ownerKindFor(ISSUE_KIND_IDS.includes(raw.kind) ? raw.kind : "conflict", title, detail, permission);
  const evidence = (Array.isArray(raw.evidence) ? raw.evidence : raw.evidence ? [raw.evidence] : [])
    .map((line) => clean(line, 200)).filter(Boolean).slice(-EVIDENCE_LINES);
  return {
    id: clean(raw.id, 60) || null,
    at: Number.isFinite(raw.at) ? raw.at : (typeof now === "number" ? now : null),
    kind,
    severity: ISSUE_KINDS[kind].severity,
    title,
    detail,
    source: ["worker", "assistant", "host"].includes(raw.source) ? raw.source : "worker",
    taskId: clean(raw.taskId, 80) || null,
    taskTitle: clean(raw.taskTitle, TITLE_MAX) || null,
    runId: clean(raw.runId, 80) || null,
    sessionId: clean(raw.sessionId, 80) || null,
    role: clean(raw.role, 40) || null,
    file: clean(raw.file, 200) || null,
    check: clean(raw.check, 120) || null,
    permission,
    attempts: Number.isFinite(raw.attempts) && raw.attempts >= 0 ? Math.floor(raw.attempts) : 0,
    splitFrom: clean(raw.splitFrom, 80) || null,
    splitDepth: splitDepthOf(raw),
    evidence,
  };
}

/** Collect the issues one run printed, capped so a job cannot flood Ask. */
function collectIssues(lines, { max = ISSUE_MAX_PER_RUN } = {}) {
  const issues = [];
  for (const line of Array.isArray(lines) ? lines : []) {
    const issue = parseIssueLine(line);
    if (!issue) continue;
    // One issue per kind+title: a retrying CLI that reprints its own output
    // must not open the same card twice.
    if (issues.some((item) => item.kind === issue.kind && item.title === issue.title)) continue;
    issues.push(issue);
    if (issues.length >= max) break;
  }
  return issues;
}

// ---- triage -----------------------------------------------------------------

const DEFAULT_POLICY = Object.freeze({
  // Kinds the assistant may settle on its own, when the attempt budget allows.
  auto: ["blocked", "check-failed", "verify", "run-failed"],
  // How many times one task may be auto-retried before the user is asked.
  autoRetryLimit: 2,
  // How many decision cards may be open at once before new ones queue behind.
  maxOpenAsks: 6,
  // How deep a follow-up chain may grow by Split; 0 turns Split off.
  splitDepth: 3,
  // "fold": an ask another card already put to the owner opens no new card.
  repeatAsks: "fold",
});

/** The policy a brain map's triage node produces, bounded and always safe. */
function normalizePolicy(raw = {}) {
  const auto = (Array.isArray(raw.auto) ? raw.auto : DEFAULT_POLICY.auto)
    .filter((kind) => AUTO_ANSWERABLE.has(kind) && !ALWAYS_ASK.has(kind));
  const limit = Number(raw.autoRetryLimit);
  const open = Number(raw.maxOpenAsks);
  // A missing depth is the default, not zero: zero is a real "Split off".
  const depth = raw.splitDepth === null || raw.splitDepth === undefined || raw.splitDepth === "" ? NaN : Number(raw.splitDepth);
  return {
    auto,
    autoRetryLimit: Number.isFinite(limit) ? Math.max(0, Math.min(5, Math.floor(limit))) : DEFAULT_POLICY.autoRetryLimit,
    maxOpenAsks: Number.isFinite(open) ? Math.max(1, Math.min(20, Math.floor(open))) : DEFAULT_POLICY.maxOpenAsks,
    splitDepth: Number.isFinite(depth) ? Math.max(0, Math.min(5, Math.floor(depth))) : DEFAULT_POLICY.splitDepth,
    repeatAsks: raw.repeatAsks === "ask" ? "ask" : "fold",
  };
}

/**
 * Decide what happens to one issue.
 *
 * `auto` means the assistant answers it and says so in the thread; `ask` means
 * the user gets a card. A kind in ALWAYS_ASK is never auto, whatever the map
 * says, and neither is anything past the attempt budget — the point of the
 * budget is that a loop stops asking the same retry of itself forever.
 */
function triageIssue(issue, { policy = DEFAULT_POLICY, openAsks = 0, now = Date.now() } = {}) {
  const normalized = normalizeIssue(issue, { now });
  if (!normalized) return { ok: false, reason: "empty-issue" };
  const rules = normalizePolicy(policy);
  const kind = ISSUE_KINDS[normalized.kind];
  const auto = kind.autoAnswer && rules.auto.includes(normalized.kind) && !ALWAYS_ASK.has(normalized.kind);
  if (auto && normalized.attempts < rules.autoRetryLimit) {
    return {
      ok: true,
      decision: "auto",
      issue: normalized,
      answer: {
        verb: ISSUE_OPTIONS[kind.autoAnswer].verb,
        optionId: kind.autoAnswer,
        label: ISSUE_OPTIONS[kind.autoAnswer].label,
        reason: `${normalized.kind} on attempt ${normalized.attempts + 1} of ${rules.autoRetryLimit}; the map lets the assistant settle this one.`,
      },
    };
  }
  return {
    ok: true,
    decision: "ask",
    issue: normalized,
    // Over the open-card budget the question still gets built; the host queues
    // it rather than dropping it, so nothing an agent asked is ever lost.
    queued: openAsks >= rules.maxOpenAsks,
    question: questionForIssue(normalized, { now, policy: rules }),
  };
}

/** The Ask card for an issue: about the task, with options that act on it. */
function questionForIssue(issue, { now = Date.now(), policy = DEFAULT_POLICY } = {}) {
  const normalized = normalizeIssue(issue, { now });
  if (!normalized) return null;
  const kind = ISSUE_KINDS[normalized.kind];
  const subject = normalized.taskTitle ? `"${clean(normalized.taskTitle, 90)}"` : "This work";
  const context = { subject };
  const evidence = normalized.evidence.length ? ` Last output: ${normalized.evidence.slice(-1)[0]}` : "";
  const where = normalized.file ? ` In ${normalized.file}.` : normalized.check ? ` Check: ${normalized.check}.` : "";
  // Split is offered only where it can land: a chain already as deep as the
  // live map allows would refuse it after the owner picked it.
  const limit = normalizePolicy(policy).splitDepth;
  const noSplit = kind.options.includes("split") && normalized.splitDepth >= limit;
  const splitNote = !noSplit ? ""
    : limit === 0 ? "Split is turned off in the live brain map."
    : `Split is not offered: this follow-up chain is already ${normalized.splitDepth} deep.`;
  const said = [
    normalized.detail ? `The agent says: ${normalized.detail}` : kind.lead,
    where.trim(),
    evidence.trim(),
  ].filter(Boolean).join(" ");
  const detail = splitNote ? `${said.slice(0, 399 - splitNote.length)} ${splitNote}` : said.slice(0, 400);
  const options = kind.options.filter((id) => !(noSplit && id === "split")).map((id) => {
    const option = ISSUE_OPTIONS[id];
    // Every answer carries what was asked, so the decision written on the
    // task (and a split card's brief) says what it was about.
    const payload = { issueKind: normalized.kind, ...(normalized.taskId ? { taskId: normalized.taskId } : {}),
      ...(normalized.permission && option.verb === "grant" ? { permission: normalized.permission } : {}),
      ask: normalized.title,
      ...(option.verb === "split" && normalized.detail ? { detail: clean(normalized.detail, 300) } : {}) };
    return {
      id,
      label: option.verb === "grant" && normalized.permission ? `Grant ${normalized.permission} for this task` : option.label,
      description: option.description,
      recommended: id === kind.recommend,
      ...(option.text ? { text: true } : {}),
      ...(option.dismiss ? { dismiss: true } : {}),
      action: { kind: "issue", action: option.verb, payload },
    };
  });
  return {
    kind: "question",
    source: "issue",
    title: `${kind.headline(context)}: ${normalized.title}`.slice(0, 240),
    detail: detail || kind.lead,
    context: {
      issueKind: normalized.kind,
      severity: normalized.severity,
      taskId: normalized.taskId,
      taskTitle: normalized.taskTitle,
      runId: normalized.runId,
      sessionId: normalized.sessionId,
      file: normalized.file,
      check: normalized.check,
      evidence: normalized.evidence,
    },
    options,
  };
}

/**
 * A run that ended without the verdict, as an issue rather than a bare retry
 * prompt: the task, why it stopped, what it last said, and how many tries it
 * has had. This is what replaces "has failed N times".
 */
function runFailureIssue({ task, failures = 1, error = null, outputTail = [], runId = null, sessionId = null, checks = [] } = {}, { now = Date.now() } = {}) {
  const title = clean(task?.title, TITLE_MAX) || "A task";
  const reason = clean(error, 160) || clean([...(Array.isArray(outputTail) ? outputTail : [])].slice(-1)[0], 160) || "it stopped without reporting done";
  const attempts = Math.max(0, Math.floor(Number(failures) || 0));
  const failedCheck = (Array.isArray(checks) ? checks : []).find((check) => check && check.ok === false);
  return normalizeIssue({
    kind: failedCheck ? "check-failed" : "run-failed",
    title: reason,
    detail: attempts > 1
      ? `Attempt ${attempts}. The worker ended without printing the done line.`
      : "The worker ended without printing the done line.",
    source: "host",
    taskId: task?.id ?? null,
    taskTitle: title,
    runId,
    sessionId,
    check: failedCheck ? clean(failedCheck.command ?? failedCheck.name, 120) : null,
    attempts,
    evidence: Array.isArray(outputTail) ? outputTail.slice(-EVIDENCE_LINES) : [],
  }, { now });
}

/**
 * The owner lane of a run's result line ("MEFI_RESULT: …; owner: reword the
 * stored acceptance"). What only the owner can do is not work this task still
 * owes, so it becomes one `owner` issue rather than a "remaining" that fails
 * verification. "none" and its kin ask for nothing.
 */
const OWNER_DENIAL = /^(?:none|nothing|nil|n\/?a|no|not\s+(?:applicable|needed|any)|leave\s+it\s+out|left\s+out|omitted)\b/i;

function ownerResultIssue(parts) {
  const owed = clean(parts?.owner, TITLE_MAX);
  // A worker that copies the template's "<…, or leave it out>" says nothing.
  const bare = owed.replace(/^[\s(<[{"'`*_.–—-]+/, "");
  if (!bare || /^<[^>]*>$/.test(owed) || OWNER_DENIAL.test(bare)) return null;
  return { kind: "owner", title: owed, source: "worker" };
}

// ---- repeat asks --------------------------------------------------------------
// The same question from another card. A split follow-up re-verifies its
// parent's work and meets the same owner-only leftover, so the ask comes back
// word for word, or reworded around the same card ids. Either way it is one
// decision: the owner has already answered it, or still has it open.
const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;
const TASK_REF = /\btask_[a-z0-9_]{8,}\b/gi;

// The other cards an ask names, sorted; the cards it is about do not count.
function askRefs(text, exclude = []) {
  const skip = new Set(exclude.filter(Boolean).map((id) => String(id).toLowerCase()));
  const ids = (String(text ?? "").match(TASK_REF) ?? []).map((id) => id.toLowerCase());
  return [...new Set(ids)].filter((id) => !skip.has(id)).sort();
}

const askWords = (text) => String(text ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The content words of an ask, card ids and filler left out and plurals and
// tenses folded ("corrected" is "correct"), for telling a reworded ask from a
// different one about the same cards.
const ASK_FILLER = new Set(["the", "and", "for", "with", "that", "this", "these", "those", "both", "are", "was", "were", "has", "have", "had",
  "will", "would", "can", "could", "should", "may", "might", "must", "you", "your", "its", "not", "but", "from", "into", "onto", "about",
  "already", "again", "still", "just", "them", "they", "their", "then", "than", "any", "all", "one", "two", "some", "there", "here", "what", "which", "who", "how", "why", "when"]);
// A light stem: "stored", "stores" and "store" all read "stor".
const stemAsk = (word) => {
  const base = word.length > 5 && word.endsWith("ing") ? word.slice(0, -3)
    : word.length > 4 && word.endsWith("ed") ? word.slice(0, -2)
    : word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
  return base.length > 3 && base.endsWith("e") ? base.slice(0, -1) : base;
};
const askTerms = (text) => new Set(askWords(String(text ?? "").replace(TASK_REF, " ")).split(" ")
  // Commit hashes and other ids are not words of the ask.
  .filter((word) => word.length >= 3 && !ASK_FILLER.has(word) && !/\d/.test(word)).map(stemAsk));

// Share of the shorter ask's content words that the other ask also uses.
function askOverlap(a, b) {
  const mine = askTerms(a);
  const theirs = askTerms(b);
  if (!mine.size || !theirs.size) return 0;
  let shared = 0;
  for (const word of mine) if (theirs.has(word)) shared += 1;
  return shared / Math.min(mine.size, theirs.size);
}

// What a saved issue question asked: the ask its options carry, or — for a
// card saved before they carried one — its title after the headline.
function savedAsk(question) {
  const payloads = (Array.isArray(question?.options) ? question.options : [])
    .map((option) => option?.action?.payload).filter((payload) => payload && typeof payload === "object");
  const pick = (key) => payloads.find((payload) => typeof payload[key] === "string" && payload[key])?.[key] ?? null;
  const title = String(question?.title ?? "");
  let ask = pick("ask");
  const kind = ISSUE_KINDS[question?.context?.issueKind];
  if (!ask && kind) {
    const taskTitle = question.context.taskTitle;
    const lead = `${kind.headline({ subject: taskTitle ? `"${clean(taskTitle, 90)}"` : "This work" })}: `;
    // A subject clipped another way still ends in its quote before the headline's own words.
    const [before, after] = kind.headline({ subject: "\u0000" }).split("\u0000");
    const at = title.indexOf(`"${after}: `, before.length);
    ask = title.startsWith(lead) ? title.slice(lead.length) : at >= 0 ? title.slice(at + after.length + 3) : null;
  }
  const detail = String(question?.detail ?? "");
  const said = detail.startsWith("The agent says: ") ? detail.slice(16).split(" Last output: ")[0] : "";
  return { ask: clean(ask ?? title, 240), detail: clean(pick("detail") ?? said, DETAIL_MAX), permission: pick("permission") };
}

/**
 * An earlier issue question that asks what this issue asks: the same kind,
 * raised inside the window, naming the same other cards in mostly the same
 * words, or asking in exactly the same words. The newest match wins. A host-raised issue (a run that stopped) is
 * about its own run and never repeats another card's. A grant or a risk is
 * about the task that asked, so another card's answer never stands in for
 * it, and an answer that could not be applied is no answer to carry over.
 */
function repeatAsk(issue, questions, { now = Date.now(), windowMs = REPEAT_WINDOW_MS } = {}) {
  const normalized = normalizeIssue(issue, { now });
  if (!normalized || normalized.source === "host" || ALWAYS_ASK.has(normalized.kind)) return null;
  const words = askWords(normalized.title);
  let found = null;
  for (const question of Array.isArray(questions) ? questions : []) {
    if (question?.source !== "issue" || !["open", "answered", "dismissed"].includes(question.status)) continue;
    if (question.status !== "open" && question.answer?.error) continue;
    if (!Number.isFinite(question.at) || now - question.at > windowMs) continue;
    const saved = savedAsk(question);
    // A card saved before the owner kind existed is read as it would be filed now.
    if (ownerKindFor(question.context?.issueKind, saved.ask, saved.detail, saved.permission) !== normalized.kind) continue;
    const exclude = [normalized.taskId, normalized.splitFrom, question.context?.taskId];
    const mine = askRefs(`${normalized.title} ${normalized.detail ?? ""}`, exclude);
    const theirs = askRefs(`${saved.ask} ${saved.detail}`, exclude);
    // The same cards alone are not the same question: two asks about one pair
    // of gate cards ("it duplicates the parent" and "both are already done")
    // must also share at least half their words, or the second never reaches
    // the owner.
    const sameCards = mine.length > 0 && mine.join(" ") === theirs.join(" ") && askOverlap(normalized.title, saved.ask) >= 0.5;
    const sameWords = words.length >= 12 && askWords(saved.ask) === words;
    if (sameCards || sameWords) found = question;
  }
  return found;
}

/** The line the worker's prompt teaches, so the protocol is discoverable. */
function issuePromptLine() {
  return `If something needs a decision only the owner can make, print one line "${ISSUE_MARK} <${ISSUE_KIND_IDS.filter((kind) => kind !== "run-failed").join("|")}> :: <one-line question> :: <what you saw>" and keep working on what you can. It reaches the owner as a card; it is not a way to end the job. Use "owner" for something only the owner can do (the board, Studio's task store, another session's files); it reaches the owner once and makes no new card.`;
}

module.exports = {
  ISSUE_MARK,
  ISSUE_MAX_PER_RUN,
  ISSUE_KINDS,
  ISSUE_KIND_IDS,
  ISSUE_OPTIONS,
  ALWAYS_ASK,
  AUTO_ANSWERABLE,
  DEFAULT_POLICY,
  REPEAT_WINDOW_MS,
  parseIssueLine,
  normalizeIssue,
  normalizePolicy,
  ownerDirected,
  collectIssues,
  triageIssue,
  questionForIssue,
  runFailureIssue,
  ownerResultIssue,
  askRefs,
  repeatAsk,
  issuePromptLine,
};
