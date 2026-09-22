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
// Pure module: no Electron, no filesystem, no network, no clock reads (time is
// injected). Everything here is data-in, data-out so the host can run it inside
// a board transaction and the tests can run it with no host at all.

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

/** Bound, clean and complete an issue from any source. */
function normalizeIssue(raw = {}, { now = null } = {}) {
  const title = clean(raw.title, TITLE_MAX);
  if (!title) return null;
  const kind = ISSUE_KIND_IDS.includes(raw.kind) ? raw.kind : "conflict";
  const evidence = (Array.isArray(raw.evidence) ? raw.evidence : raw.evidence ? [raw.evidence] : [])
    .map((line) => clean(line, 200)).filter(Boolean).slice(-EVIDENCE_LINES);
  return {
    id: clean(raw.id, 60) || null,
    at: Number.isFinite(raw.at) ? raw.at : (typeof now === "number" ? now : null),
    kind,
    severity: ISSUE_KINDS[kind].severity,
    title,
    detail: clean(raw.detail, DETAIL_MAX) || null,
    source: ["worker", "assistant", "host"].includes(raw.source) ? raw.source : "worker",
    taskId: clean(raw.taskId, 80) || null,
    taskTitle: clean(raw.taskTitle, TITLE_MAX) || null,
    runId: clean(raw.runId, 80) || null,
    sessionId: clean(raw.sessionId, 80) || null,
    role: clean(raw.role, 40) || null,
    file: clean(raw.file, 200) || null,
    check: clean(raw.check, 120) || null,
    permission: clean(raw.permission, 60) || null,
    attempts: Number.isFinite(raw.attempts) && raw.attempts >= 0 ? Math.floor(raw.attempts) : 0,
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
});

/** The policy a brain map's triage node produces, bounded and always safe. */
function normalizePolicy(raw = {}) {
  const auto = (Array.isArray(raw.auto) ? raw.auto : DEFAULT_POLICY.auto)
    .filter((kind) => AUTO_ANSWERABLE.has(kind) && !ALWAYS_ASK.has(kind));
  const limit = Number(raw.autoRetryLimit);
  const open = Number(raw.maxOpenAsks);
  return {
    auto,
    autoRetryLimit: Number.isFinite(limit) ? Math.max(0, Math.min(5, Math.floor(limit))) : DEFAULT_POLICY.autoRetryLimit,
    maxOpenAsks: Number.isFinite(open) ? Math.max(1, Math.min(20, Math.floor(open))) : DEFAULT_POLICY.maxOpenAsks,
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
    question: questionForIssue(normalized, { now }),
  };
}

/** The Ask card for an issue: about the task, with options that act on it. */
function questionForIssue(issue, { now = Date.now() } = {}) {
  const normalized = normalizeIssue(issue, { now });
  if (!normalized) return null;
  const kind = ISSUE_KINDS[normalized.kind];
  const subject = normalized.taskTitle ? `"${clean(normalized.taskTitle, 90)}"` : "This work";
  const context = { subject };
  const evidence = normalized.evidence.length ? ` Last output: ${normalized.evidence.slice(-1)[0]}` : "";
  const where = normalized.file ? ` In ${normalized.file}.` : normalized.check ? ` Check: ${normalized.check}.` : "";
  const detail = [
    normalized.detail ? `The agent says: ${normalized.detail}` : kind.lead,
    where.trim(),
    evidence.trim(),
  ].filter(Boolean).join(" ").slice(0, 400);
  const options = kind.options.map((id) => {
    const option = ISSUE_OPTIONS[id];
    const payload = { issueKind: normalized.kind, ...(normalized.taskId ? { taskId: normalized.taskId } : {}),
      ...(normalized.permission && option.verb === "grant" ? { permission: normalized.permission } : {}) };
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

/** The line the worker's prompt teaches, so the protocol is discoverable. */
function issuePromptLine() {
  return `If something needs a decision only the owner can make, print one line "${ISSUE_MARK} <${ISSUE_KIND_IDS.filter((kind) => kind !== "run-failed").join("|")}> :: <one-line question> :: <what you saw>" and keep working on what you can. It reaches the owner as a card; it is not a way to end the job.`;
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
  parseIssueLine,
  normalizeIssue,
  normalizePolicy,
  collectIssues,
  triageIssue,
  questionForIssue,
  runFailureIssue,
  issuePromptLine,
};
