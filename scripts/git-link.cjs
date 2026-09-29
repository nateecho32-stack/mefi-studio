// Mefi's Studio AI+ — the GitHub link's shared rules: one vocabulary for where
// a project stands against GitHub, and the checks and sentences that
// vocabulary needs. The chip in Vibe home and every section bar, the launch
// list's rows, the Save-and-push and Publish dialogs and the toasts all say
// each state the same way because they all read it from here: a frozen table
// (`STATES`, a row for each state id: label, tone, glyph name, sentence, primary
// and secondary action), `describe` (the facts main.cjs gathered in, the chip
// model out, by priority: working, problems, linking, both changed, to pull,
// other branch, to push, changes, in sync), the repository-name rules, the
// .gitignore and license text a new project gets, what a git or gh failure
// means and what to offer, which paths never belong in a commit, and the
// fixed steps of a publish as data (scripts/git-actions.cjs runs them).
//
// Sentences that already ship in scripts/sync.mjs, pc-setup.cjs and main.cjs
// are reused word for word; the ones marked `proposed` are new copy from the
// design brief. A launch row and the in-app chip read the same row, so a state
// never has two names.
//
// Pure module: no Electron, no filesystem, no network, no clock reads.
// Callers pass everything they read, and the year or time they want printed;
// git and gh output arrives as text and leaves as a sentence.
// Guarded by tests/git_link.test.mjs.
"use strict";

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const count = (value) => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.floor(Number(value)) : 0);
const text = (value) => (typeof value === "string" ? value : "");
const article = (name) => `${/^[aeiou]/i.test(name) ? "an" : "a"} ${name}`;
const fill = (template, vars) => String(template ?? "").replace(/\{(\w+)\}/g, (_, key) => String(vars?.[key] ?? ""));

// Git and gh output never leaves this module with a login in a URL or a token.
const scrub = (value) => {
  let raw = "";
  try { raw = String(value ?? ""); } catch { raw = ""; } // a Symbol or an object with no string form is nothing to show
  return raw
    // Anchored on "://" itself: a scheme-first pattern re-scanned every long word from each of its letters (80 KB took 8 s).
    .replace(/(:\/\/)[^/@\s]+@/g, "$1")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, "[token]")
    // Older 40-character tokens have no prefix: they show up as a header value or an environment assignment.
    .replace(/\b(authorization\s*[:=]\s*(?:bearer|basic|token)\s+)[^\s'"]+/gi, "$1[token]")
    .replace(/\b((?:GH|GITHUB)_TOKEN\s*[:=]\s*)[^\s'"]+/g, "$1[token]");
};
const linesOf = (value) => scrub(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
// The line worth showing from a failed command: not git's closing "hint:" lines.
const usefulLine = (value) => {
  const lines = linesOf(value).map((line) => line.replace(/^(?:remote|error|fatal):\s*/i, "").trim()).filter(Boolean);
  return lines.filter((line) => !/^hint:/i.test(line)).at(-1) ?? lines.at(-1) ?? "";
};

// ---- the vocabulary ---------------------------------------------------------
// One row per state id of the design brief's section 3, in its order. `glyph`
// is the name of the 16px stroke drawing the renderer keeps for it (several
// states share a picture but keep their own name). `{name}` marks a blank the
// chip model fills: {m} the default branch, {ahead} "2 commits" to push,
// {behind} "3 commits" to pull, {uncommitted} "4 uncommitted files", {changed}
// "4 files", {branch}, {repo}, {detail} and so on. `proposed` rows say new
// words; the rest are shipped ones, word for word.
const deepFreeze = (value) => {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
};

const ROWS = deepFreeze([
  {
    id: "not-repo", label: "Not a repo", tone: "neutral", glyph: "not-repo",
    sentence: "This project folder is not a Git repository, so there is nothing to sync.",
    primary: { id: "setup-git", label: "Set up Git and GitHub" }, secondary: { id: "not-now", label: "Not now" },
  },
  {
    id: "no-commits", label: "No commits yet", tone: "neutral", glyph: "no-commits", proposed: true,
    sentence: "No commits yet. Save a first commit, then publish.", // proposed
    primary: { id: "save-first", label: "Save a first commit" }, secondary: { id: "publish-later", label: "Publish later" },
  },
  {
    id: "no-remote", label: "Only on this PC", tone: "neutral", glyph: "no-remote", proposed: true,
    sentence: "This project is only on this PC. Publish it to GitHub once to link your PCs.", // proposed
    shipped: "This project has no origin remote yet. Publish it to GitHub once to link your PCs.",
    primary: { id: "publish", label: "Publish to GitHub" }, secondary: { id: "link", label: "Link to a repo I already have" },
  },
  {
    id: "other-remote", label: "Linked elsewhere", tone: "neutral", glyph: "other-remote", proposed: true,
    sentence: "This project is linked somewhere other than GitHub, so Studio leaves it alone.", // proposed
    primary: null, secondary: { id: "show-address", label: "Show address" },
  },
  {
    id: "signed-out", label: "Sign in", tone: "warn", glyph: "signed-out", proposed: true,
    sentence: "Sign in to GitHub first.", // proposed
    primary: { id: "sign-in", label: "Sign in to GitHub" }, secondary: { id: "not-now", label: "Not now" },
  },
  {
    id: "checking", label: "Checking…", tone: "neutral", glyph: "checking", proposed: true,
    sentence: "Looking at GitHub. Nothing is being changed.", // proposed
    primary: null, secondary: null,
  },
  {
    id: "in-sync", label: "In sync", tone: "good", glyph: "in-sync",
    sentence: "This PC matches GitHub {m}.",
    primary: { id: "check", label: "Check GitHub" }, secondary: { id: "open-github", label: "Open on GitHub" },
  },
  {
    id: "ahead", label: "{n} to push", tone: "info", glyph: "ahead",
    sentence: "Some work on this PC is not on GitHub yet.",
    primary: { id: "push", label: "Push {ahead}" }, secondary: { id: "show-push", label: "Show what will be pushed" },
  },
  {
    id: "behind", label: "{n} to pull", tone: "info", glyph: "behind",
    sentence: "GitHub has {behind} this PC has not pulled yet.",
    primary: { id: "pull", label: "Pull {behind}" }, secondary: { id: "show-changes", label: "Show what changed" },
  },
  {
    id: "diverged", label: "Both changed", tone: "warn", glyph: "diverged",
    sentence: "{m} changed on this PC and on GitHub. Put this PC's commits on top of GitHub's, then sync.",
    dirtySentence: "{m} changed on this PC and on GitHub. Commit or set aside the uncommitted files, then put this PC's commits on top of GitHub's.",
    primary: { id: "rebase", label: "Put my commits on top of GitHub's" }, secondary: { id: "ask-mefi-combine", label: "Ask Mefi to combine them" },
  },
  {
    id: "uncommitted", label: "{n} changes", labelOne: "1 change", tone: "info", glyph: "uncommitted",
    sentence: "{uncommitted} in this checkout.",
    primary: { id: "save-and-push", label: "Save and push {changed}" }, secondary: { id: "save", label: "Save only" },
  },
  {
    id: "other-branch", label: "On {branch}", tone: "warn", glyph: "other-branch",
    sentence: "This checkout is on {where}, not {m}.",
    primary: { id: "push", label: "Push this branch" }, secondary: { id: "details", label: "Details" },
  },
  {
    id: "no-upstream", label: "Not pushed yet", tone: "info", glyph: "no-upstream", proposed: true,
    sentence: "GitHub does not have {m} yet. Push it once to link your PCs.", // proposed
    shipped: "GitHub has no origin/{m} yet. Push {m} once to link your PCs.",
    primary: { id: "push", label: "Push {m} to GitHub" }, secondary: { id: "open-github", label: "Open on GitHub" },
  },
  {
    id: "offline", label: "Offline", tone: "neutral", glyph: "offline",
    sentence: "GitHub could not be reached. Some work on this PC is not on GitHub yet.",
    cleanSentence: "GitHub could not be reached. As of the last check, this PC matched GitHub.",
    primary: { id: "retry", label: "Try again" }, secondary: { id: "save", label: "Save on this PC" },
  },
  {
    id: "fetch-failed", label: "Can't check GitHub", tone: "bad", glyph: "fetch-failed",
    sentence: "Couldn't check GitHub ({detail}). Sign in to GitHub again or check this project's GitHub address; nothing was changed.",
    primary: { id: "sign-in", label: "Sign in again" }, secondary: { id: "retry", label: "Try again" },
  },
  {
    id: "agents-working", label: "Agents building", tone: "info", glyph: "agents-working", proposed: true,
    sentence: "Agents are still changing files in this project. Pull now anyway?", // proposed
    primary: { id: "pull-anyway", label: "Pull now" }, secondary: { id: "wait", label: "Wait" },
  },
  {
    id: "saving", label: "Saving…", tone: "info", glyph: "saving", proposed: true,
    sentence: "Saving {changed} on this PC.", // proposed
    primary: null, secondary: null,
  },
  {
    id: "pushing", label: "Pushing…", tone: "info", glyph: "pushing", proposed: true,
    sentence: "Checking nothing was left out. Running the project's check. Uploading {ahead}.", // proposed
    primary: null, secondary: { id: "details", label: "Details" },
  },
  {
    id: "pulling", label: "Pulling…", tone: "info", glyph: "pulling", proposed: true,
    sentence: "Getting {behind} from GitHub…", // proposed
    primary: null, secondary: null,
  },
  {
    id: "publishing", label: "Publishing…", tone: "info", glyph: "publishing", proposed: true,
    sentence: "Saving a first commit. Creating {repo}. Uploading.", // proposed
    primary: null, secondary: null,
  },
  {
    id: "check-failed", label: "Check failed", tone: "bad", glyph: "check-failed",
    sentence: "The project's check failed, so nothing was pushed. Fix it, then sync again.",
    primary: { id: "ask-mefi-fix", label: "Ask Mefi to fix it" }, secondary: { id: "show-output", label: "Show check output" },
  },
  {
    id: "lost-work", label: "Held back", tone: "bad", glyph: "lost-work",
    sentence: "Nothing was pushed. Merge {sha} ({subject}) left out {lines} of {fileCount} another branch changed ({names}). Restore them, or if that was deliberate say so with a \"Lost-work-ok: <why>\" line in a commit message.",
    primary: { id: "ask-mefi-restore", label: "Ask Mefi to restore them" }, secondary: { id: "show-files", label: "Show the files" },
  },
  {
    id: "conflict", label: "Needs merging", tone: "bad", glyph: "conflict",
    sentence: "Your commits and GitHub's both change {names}. Nothing was changed; merge them by hand or ask Mefi.",
    primary: { id: "ask-mefi-merge", label: "Ask Mefi to merge" }, secondary: { id: "open-folder", label: "Open the folder" },
  },
  {
    // What GitHub refused is worded by classifyPush (four proposed sentences); this is
    // the shipped one for a refusal nobody named.
    id: "push-refused", label: "GitHub said no", tone: "bad", glyph: "push-refused",
    sentence: "GitHub refused the push: {detail}",
    primary: { id: "retry", label: "Try again" }, secondary: { id: "details", label: "Details" },
  },
  {
    id: "blocked-secret", label: "Stopped", tone: "bad", glyph: "blocked-secret", proposed: true,
    sentence: "Stopped: {what} in {file}.", // proposed
    primary: { id: "leave-out", label: "Leave that file out" }, secondary: { id: "show-where", label: "Show where" },
  },
  {
    id: "too-large", label: "File too big", tone: "warn", glyph: "too-large", proposed: true,
    sentence: "{file} is {mb} MB; GitHub refuses files over 100 MB.", // proposed
    primary: { id: "leave-out-ignore", label: "Leave it out and ignore it" }, secondary: { id: "show-file", label: "Show the file" },
  },
  {
    id: "folder-missing", label: "Folder missing", tone: "warn", glyph: "folder-missing",
    sentence: "That project folder is unavailable. Reconnect it before switching.",
    primary: { id: "find-folder", label: "Find the folder" }, secondary: { id: "remove", label: "Remove from list" },
  },
  {
    id: "unknown", label: "Not checked", tone: "neutral", glyph: "unknown", proposed: true,
    sentence: "Git state not read yet.", // proposed
    primary: null, secondary: null,
  },
  {
    id: "success", label: "Done", tone: "good", glyph: "success",
    sentence: "Pushed {commits} to GitHub.",
    primary: { id: "open-github", label: "Open on GitHub" }, secondary: { id: "done", label: "Done" },
  },
  {
    id: "pull-refused", label: "Can't pull now", tone: "warn", glyph: "pull-refused",
    sentence: "Could not fast-forward {m} (uncommitted edits in the way?): {detail}",
    primary: { id: "save", label: "Save my changes" }, secondary: { id: "show-files", label: "Show the files" },
  },
  {
    id: "error", label: "Sync did not run", tone: "bad", glyph: "error",
    sentence: "Sync could not run: {message}",
    primary: { id: "retry", label: "Try again" }, secondary: { id: "details", label: "Details" },
  },
]);

// The table keyed by state id (in the brief's order), and that order on its own.
const STATES = Object.freeze(Object.fromEntries(ROWS.map((row) => [row.id, row])));
const STATE_IDS = Object.freeze(ROWS.map((row) => row.id));

// What a finished action says once it is done (the `success` row).
const OUTCOMES = deepFreeze({
  pushed: "Pushed {commits} to GitHub.",
  pulled: "Pulled {commits} from GitHub.",
  rebased: "Put {commits} from this PC on top of GitHub's.",
  published: "Published {repo}.", // proposed
  saved: "Saved {changed} on this PC.", // proposed
});

// Every action id a row (or a classification) can offer. The host maps each to
// a bridge call; an id no surface can act on is left out, never guessed at.
const ACTION_IDS = Object.freeze([...new Set([
  ...ROWS.flatMap((row) => [row.primary?.id, row.secondary?.id]),
  "start-branch", "install-gh", "install-git", "add-permission", "push-branch", "pick-owner", "rename", "wait",
].filter(Boolean))]);

// The moves that change something off this PC or in its history: the popover
// button is their one light confirm.
const CONFIRM = new Set(["push", "push-branch", "rebase"]);

// ---- describe: facts in, chip model out --------------------------------------
const BUSY = Object.freeze(["saving", "pushing", "pulling", "publishing", "checking"]);
// Problems by how much they stop: the top one is the chip.
const PROBLEM_RANK = Object.freeze(["error", "fetch-failed", "conflict", "lost-work", "blocked-secret", "too-large", "check-failed", "push-refused", "pull-refused", "offline"]);
const DETAIL_CAP = 12;
// Pending items of the last sync worth a line of their own (the rest is the sentence).
const PENDING_LINES = new Set(["stash", "worktree", "local-branch", "github-branch", "lost-work"]);

function remoteOf(value) {
  if (value === true) return { kind: "github", repo: null };
  if (typeof value === "string" && value) return /^[^/\s]+\/[^/\s]+$/.test(value) ? { kind: "github", repo: value } : { kind: "other", repo: null };
  return { kind: "none", repo: null };
}

// The signed-in account, as the host knows it: undefined = not asked yet (never
// "signed out"), null = asked and nobody is, a name, or pc-setup's answer shape.
function accountOf(value) {
  if (value === undefined) return { known: false, name: null, gh: true };
  if (value && typeof value === "object") {
    const known = value.ok !== false && "account" in value;
    return { known, name: known ? text(value.account) || null : null, gh: value.ghInstalled !== false };
  }
  return { known: true, name: text(value) || null, gh: true };
}

// The local look at a checkout: the glance itself, else what the last sync saw.
function glanceOf(glance, sync) {
  if (glance && typeof glance === "object" && typeof glance.isRepo === "boolean") return glance;
  const state = sync?.state;
  if (!state || typeof state !== "object" || typeof state.repo !== "boolean") return null;
  const detached = state.branch === "HEAD";
  return {
    isRepo: state.repo, unborn: false, branch: detached ? null : text(state.branch) || null, detached, dirty: state.dirty, ahead: state.ahead, behind: state.behind,
    upstream: state.hasUpstream ? text(state.upstream) : null, remote: state.remote ? true : null, main: text(state.main) || null,
    onDefault: !detached && state.branch === state.main, available: true,
  };
}

function context(input) {
  const i = input && typeof input === "object" ? input : {};
  const sync = i.sync && typeof i.sync === "object" ? i.sync : null;
  const g = glanceOf(i.glance, sync);
  const project = i.project && typeof i.project === "object" ? i.project : {};
  const remote = remoteOf(g?.remote);
  const account = accountOf(i.account);
  const detached = Boolean(g && !g.unborn && (g.detached === true || g.branch === "HEAD"));
  const branch = g && !detached && text(g.branch) && g.branch !== "HEAD" ? g.branch : null;
  const main = text(g?.main) || text(sync?.state?.main) || (g?.onDefault === true && branch) || "main";
  const onDefault = !g ? true : detached ? false : typeof g.onDefault === "boolean" ? g.onDefault : branch ? branch === main : true;
  const checked = [i.checkedAt, sync?.checkedAt].find((value) => Number.isFinite(value));
  return {
    g, sync, project, remote, account, detached, branch, main, onDefault,
    counts: { ahead: count(g?.ahead), behind: count(g?.behind), dirty: count(g?.dirty) },
    upstream: text(g?.upstream) || null,
    busy: BUSY.includes(i.busy) ? i.busy : null,
    agents: Boolean(i.agentsBuilding),
    checkedAt: checked ?? null,
    outcome: i.outcome && typeof i.outcome === "object" && typeof i.outcome.kind === "string" && Object.hasOwn(OUTCOMES, i.outcome.kind) ? i.outcome : null,
    refusal: i.refusal && typeof i.refusal === "object" && typeof i.refusal.kind === "string" ? i.refusal : null,
    needsGitHub: project.needsGitHub === true || remote.kind === "github",
  };
}

// Whether the last sync's complaint still describes the checkout: a refused
// push with nothing left to push, or a divergence that is gone, is history.
function live(kind, c) {
  if (!c.g) return true;
  const { ahead, behind } = c.counts;
  if (kind === "diverged" || kind === "rebase-conflict") return ahead > 0 && behind > 0;
  // A branch never pushed has no upstream to be ahead of: what it tried still stands.
  if (kind === "push-refused" || kind === "check-failed" || kind === "lost-work") return ahead > 0 || !c.upstream;
  if (kind === "pull-refused") return behind > 0;
  return true;
}

// The failed push a sync recorded says only its last stderr line; a fuller
// `stderr` on the problem (or a `refusal` the host classified) says more.
const PUSH_STATE = { "non-fast-forward": "push-refused", "protected-branch": "push-refused", "workflow-scope": "push-refused", auth: "push-refused", "not-found": "fetch-failed", offline: "offline", "too-large": "too-large", secret: "blocked-secret", unknown: "push-refused" };

function classified(cls, c) {
  const id = typeof cls.kind === "string" && Object.hasOwn(PUSH_STATE, cls.kind) ? PUSH_STATE[cls.kind] : null;
  return id ? { id, cls, detail: scrub(text(cls.detail)), file: cls.file, label: cls.label, mb: cls.mb } : null;
}

function syncProblem(raw, c) {
  if (!raw || typeof raw !== "object") return null;
  const detail = scrub(text(raw.detail));
  switch (raw.kind) {
    case "offline": return { id: "offline", detail };
    case "fetch-failed": return { id: "fetch-failed", detail };
    case "rebase-conflict": return live(raw.kind, c) ? { id: "conflict", files: Array.isArray(raw.files) ? raw.files.map(text).filter(Boolean) : [] } : null;
    case "lost-work": return live(raw.kind, c) ? { id: "lost-work", detail, findings: Array.isArray(raw.findings) ? raw.findings : [] } : null;
    case "check-failed": return live(raw.kind, c) ? { id: "check-failed", detail } : null;
    case "pull-refused": return live(raw.kind, c) ? { id: "pull-refused", detail } : null;
    case "push-refused": {
      if (!live(raw.kind, c)) return null;
      const cls = classifyPush(text(raw.stderr) || detail);
      return classified(cls, c) ?? { id: "push-refused", detail, cls };
    }
    case "error": return { id: "error", message: scrub(text(c.sync?.headline).replace(/^Sync could not run:\s*/i, "")) || detail };
    default: return null;
  }
}

function worstProblem(c) {
  const found = [];
  if (c.refusal) {
    const cls = { ...c.refusal, detail: c.refusal.detail ?? "" };
    const problem = classified(cls, c);
    if (problem) found.push(problem);
    else if (cls.kind !== "timeout") found.push({ id: "error", message: text(cls.text) || "GitHub said no.", cls });
  }
  for (const raw of Array.isArray(c.sync?.problems) ? c.sync.problems : []) {
    const problem = syncProblem(raw, c);
    if (problem) found.push(problem);
  }
  found.sort((a, b) => PROBLEM_RANK.indexOf(a.id) - PROBLEM_RANK.indexOf(b.id));
  return found[0] ?? null;
}

function decide(c) {
  if (c.g && c.g.available === false) return { id: "folder-missing" };
  if (c.busy) return { id: c.busy };
  const problem = worstProblem(c);
  if (problem) return problem;
  if (c.outcome) return { id: "success" };
  if (!c.g) return { id: "unknown" };
  if (c.needsGitHub && c.account.known && !c.account.name) return { id: "signed-out" };
  if (!c.g.isRepo) return { id: "not-repo" };
  if (c.g.unborn) return { id: "no-commits" };
  if (c.remote.kind === "none") return { id: "no-remote" };
  if (c.remote.kind === "other") return { id: "other-remote" };
  if (c.onDefault && !c.upstream) return { id: "no-upstream" };
  if (c.onDefault && c.counts.ahead && c.counts.behind) return { id: "diverged" };
  if (c.onDefault && c.counts.behind) return { id: c.agents ? "agents-working" : "behind" };
  if (!c.onDefault) return { id: "other-branch" };
  if (c.counts.ahead) return { id: "ahead" };
  if (c.counts.dirty) return { id: "uncommitted" };
  return { id: "in-sync" };
}

// The sentence for a lost-work finding, as scripts/sync.mjs lostWorkText words it.
function lostWorkSentence(finding, { blocked = false } = {}) {
  const files = Array.isArray(finding?.files) ? finding.files.map((file) => text(file?.path)).filter(Boolean) : [];
  const total = count(finding?.count) || files.length;
  const named = files.slice(0, 3);
  const more = total - named.length;
  return `${blocked ? "Nothing was pushed. " : ""}Merge ${text(finding?.merge).slice(0, 7)} (${text(finding?.subject) || "no subject"}) left out ${plural(count(finding?.lines), "line")} of ${plural(total, "file")} another branch changed (${named.join(", ")}${more > 0 ? ` and ${more} more` : ""}). ` +
    "Restore them, or if that was deliberate say so with a \"Lost-work-ok: <why>\" line in a commit message.";
}

function build(decision, c) {
  const row = STATES[decision.id] ?? STATES.unknown;
  const id = row.id;
  const { ahead, behind, dirty } = c.counts;
  const n = id === "ahead" ? ahead : id === "behind" ? behind : id === "uncommitted" ? dirty : 0;
  const outcome = c.outcome ?? {};
  const repo = c.remote.repo ?? (text(c.project.repo) || null);
  const vars = {
    m: c.main, branch: c.branch ?? "", n,
    ahead: ahead ? plural(ahead, "commit") : "your commits",
    behind: behind ? plural(behind, "commit") : "new commits",
    uncommitted: plural(dirty, "uncommitted file"),
    changed: dirty ? plural(dirty, "file") : "your files",
    repo: repo ?? "the GitHub project",
    detail: decision.detail ?? "", message: decision.message ?? "",
    where: c.detached ? "a detached HEAD" : `branch ${c.branch ?? "HEAD"}`,
    commits: plural(count(outcome.commits), "commit"),
    what: decision.label ? article(decision.label) : "a secret", file: text(decision.file) || "a file", mb: decision.mb ?? "",
    names: (decision.files ?? []).slice(0, 3).join(", ") || "the same lines",
  };
  let label = row.label;
  if (id === "uncommitted" && dirty === 1) label = row.labelOne;
  if (id === "other-branch" && c.detached) label = "Not on a branch";
  label = fill(label, vars);

  let sentence = fill(row.sentence, vars);
  const cls = decision.cls;
  if (id === "diverged" && dirty) sentence = fill(row.dirtySentence, vars);
  else if (id === "offline") sentence = fill(cls?.text && cls.kind === "offline" ? cls.text : (c.sync?.pending?.length || dirty || ahead ? row.sentence : row.cleanSentence), vars);
  else if (id === "success") sentence = fill(OUTCOMES[outcome.kind] ?? row.sentence, { ...vars, changed: plural(count(outcome.files), "file"), repo: text(outcome.repo) || vars.repo });
  else if (id === "lost-work") sentence = decision.detail || (decision.findings?.[0] ? lostWorkSentence(decision.findings[0], { blocked: true }) : "Nothing was pushed. A merge left out work another branch changed. Restore it, or if that was deliberate say so with a \"Lost-work-ok: <why>\" line in a commit message.");
  else if (id === "push-refused") sentence = cls && cls.kind !== "unknown" ? cls.text : decision.detail ? fill(row.sentence, vars) : "GitHub refused the push.";
  else if (id === "fetch-failed" && cls) sentence = cls.text;
  else if (id === "blocked-secret" || id === "too-large") sentence = cls?.text || fill(row.sentence, vars);
  else if (id === "error" && !decision.message) sentence = "Sync could not run.";
  else if (id === "folder-missing" || id === "unknown") sentence = row.sentence;

  const short = ["ahead", "behind", "uncommitted"].includes(id) && n ? String(n) : "";
  const model = {
    id, label, short, tone: row.tone, glyph: row.glyph, sentence: scrub(sentence),
    details: detailsFor(id, c, decision, vars),
    branch: c.detached ? null : c.branch, repo, checkedAt: c.checkedAt,
    counts: { ahead, behind, dirty },
    primary: action(row.primary, vars), secondary: action(row.secondary, vars),
    busy: BUSY.includes(id) ? id : null,
  };
  return refine(model, c, decision, vars);
}

function action(spec, vars) {
  if (!spec) return null;
  return { id: spec.id, label: fill(spec.label, vars), confirm: CONFIRM.has(spec.id) };
}

// The moves that depend on more than the state's own row.
function refine(model, c, decision, vars) {
  const { id } = model;
  const { dirty } = c.counts;
  const primary = model.primary;
  if (id === "signed-out" && !c.account.gh) {
    model.primary = { id: "install-gh", label: "Install GitHub CLI", confirm: false };
    model.sentence = "GitHub CLI is not installed on this PC.";
  } else if (id === "no-remote" && c.project.weakDrive === true) {
    model.primary = { ...primary, disabled: true, why: "This drive cannot keep a Git project reliably. Move the project to an NTFS drive first." }; // proposed
  } else if (id === "diverged") {
    if (dirty) model.primary = { id: "save", label: "Save my changes", confirm: false };
    else model.primary = { ...primary, confirm: true };
  } else if (id === "other-branch") {
    if (c.detached) model.primary = { id: "start-branch", label: "Start a branch here", confirm: false };
    else if (!c.upstream) model.primary = { ...primary, confirm: true };
    else if (!c.counts.ahead) model.primary = { ...primary, confirm: true, disabled: true, why: "Nothing on this branch is waiting to be pushed." }; // proposed
    else model.primary = { ...primary, confirm: true };
  } else if (id === "offline") {
    if (!dirty) model.secondary = null;
  } else if (id === "pull-refused") {
    if (!dirty) model.primary = { id: "pull", label: "Try again", confirm: false };
  } else if (id === "push-refused" && decision.cls) {
    const fix = decision.cls.fix;
    if (fix === "pull") model.primary = { id: "pull", label: "Pull, then push", confirm: false };
    else if (fix === "sign-in") model.primary = { id: "sign-in", label: "Sign in again", confirm: false };
    else if (fix === "add-permission") model.primary = { id: "add-permission", label: "Add permission", confirm: false };
    else if (fix === "push-branch") model.primary = { id: "push-branch", label: "Push a branch", confirm: true };
  } else if (id === "success") {
    // Something to open only once it is on GitHub: not a save, and not a project that is not linked.
    if (c.remote.kind !== "github" || c.outcome?.kind === "saved") model.primary = null;
  }
  // Push never commits silently: with files to save, the primary is the dialog
  // that shows them, and pushing the commits alone moves to the second action.
  if (dirty > 0 && ["ahead", "no-upstream", "other-branch"].includes(id) && model.primary?.id === "push") {
    model.secondary = { id: "push", label: id === "ahead" ? `Push ${vars.ahead} only` : "Push without saving", confirm: true }; // proposed
    model.primary = { id: "save-and-push", label: `Save and push ${plural(dirty, "file")}`, confirm: false };
  }
  return model;
}

function detailsFor(id, c, decision, vars) {
  const out = [];
  const add = (line) => { const value = text(line).trim(); if (value && !out.includes(value)) out.push(value); };
  const { ahead, behind, dirty } = c.counts;
  const m = c.main;
  if (id === "ahead") add(`${plural(ahead, "commit")} on ${m} not pushed yet.`);
  if (id === "behind" || id === "agents-working") add(`${plural(behind, "commit")} on ${m} not pulled yet.`); // proposed
  if (id === "diverged") {
    add(`${plural(ahead, "commit")} on this PC not on GitHub.`); // proposed
    add(`${plural(behind, "commit")} on GitHub not on this PC.`); // proposed
    if (!dirty) add("Both sets of work stay. If the same lines clash, nothing is changed."); // proposed
  }
  if (id === "uncommitted") add("Uncommitted files stay on this PC unless you save them."); // proposed
  if (id === "other-branch") {
    if (c.detached) add("Start a branch here to save or push this work."); // proposed
    else if (!c.upstream) add("This branch is not on GitHub yet."); // proposed
    else if (ahead) add(`${plural(ahead, "commit")} on ${c.branch} not pushed yet.`);
  }
  if (id === "no-remote") add("You choose the name and who can see it next. Private is the default."); // proposed
  if (id === "signed-out") add("You sign in on GitHub's own page. Studio never asks for your password."); // proposed
  if (id === "offline" && decision.detail) add(`Could not reach GitHub: ${decision.detail}`);
  if (id === "check-failed" && decision.detail) add(`npm run check: ${decision.detail}`);
  // A known refusal says itself; git's closing hint line is only worth showing for one nobody named.
  if (id === "push-refused" && decision.detail && (!decision.cls || decision.cls.kind === "unknown")) add(`GitHub refused the push: ${decision.detail}`);
  if (id === "lost-work") for (const finding of (decision.findings ?? []).slice(1)) add(lostWorkSentence(finding));
  if (id === "pushing") ["Checking nothing was left out", "Running the project's check", `Uploading ${vars.ahead}`].forEach(add); // proposed
  if (id === "publishing") ["Saving a first commit", `Creating ${vars.repo}`, "Uploading"].forEach(add); // proposed
  if (id === "success" && c.outcome?.kind === "published") add(c.outcome.visibility === "public" ? "Public. Anyone on GitHub can see it." : "Private. Only you can see it."); // proposed
  const working = BUSY.includes(id);
  if (dirty && !["uncommitted", "saving", "folder-missing"].includes(id) && !working) add(`${plural(dirty, "uncommitted file")} in this checkout.`);
  for (const item of Array.isArray(c.sync?.pending) ? c.sync.pending : []) if (item && PENDING_LINES.has(item.kind)) add(scrub(text(item.text)));
  return out.length > DETAIL_CAP ? [...out.slice(0, DETAIL_CAP - 1), `and ${out.length - DETAIL_CAP + 1} more.`] : out;
}

/**
 * The chip model for one project. Input (every field optional):
 *   glance   { isRepo, unborn, branch, detached, dirty, ahead, behind, upstream,
 *              remote: "owner/name" | "other" | null, onDefault, available }
 *   sync     the last scripts/sync.mjs result (its problems and pending items)
 *   account  the signed-in login, null (asked, nobody), undefined (not asked),
 *            or pc-setup's { account, ghInstalled }
 *   busy     "saving" | "pushing" | "pulling" | "publishing" | "checking" | null
 *   checkedAt, agentsBuilding, project { needsGitHub, weakDrive, repo }
 *   outcome  { kind: "pushed"|"pulled"|"rebased"|"published"|"saved", commits, files, repo, visibility }
 *            the action that just finished, until the host clears it
 *   refusal  a classifyPush result (or a preview block) still standing
 * Output: { id, label, short, tone, glyph, sentence, details, branch, repo,
 *           checkedAt, counts, primary, secondary, busy }. `short` is what a
 * chip too narrow for words still shows: the number, or nothing.
 */
function describe(input) {
  const c = context(input);
  return build(decide(c), c);
}

// What a launch row and the projects glance carry: the chip, or nothing when
// nothing was read (unknown is never drawn as a guess).
function chip(model) {
  if (!model || model.id === "unknown") return null;
  return { id: model.id, label: model.label, tone: model.tone, glyph: model.glyph, sentence: model.sentence };
}

// ---- repository names --------------------------------------------------------
// pc-setup.cjs REPO's shape (the app's own validator), plus GitHub's own no's.
// An account name cannot begin or end with a hyphen (and one that began with it would be read as an option by `gh repo create`).
const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;
const NAME = /^[A-Za-z0-9._-]{1,100}$/;

function repoIssue(owner, name) {
  const who = text(owner);
  const what = text(name);
  if (!OWNER.test(who)) return "That GitHub account name is not valid.";
  if (!what) return "Give the project a GitHub name.";
  if (what.length > 100) return "A GitHub name can be up to 100 characters.";
  if (what === "." || what === "..") return "GitHub does not accept \".\" or \"..\" as a name.";
  if (/\.git$/i.test(what)) return "A GitHub name cannot end with .git.";
  if (!NAME.test(what)) return "Use letters, numbers, dots, dashes and underscores.";
  return null;
}

const validRepo = (owner, name) => typeof owner === "string" && typeof name === "string" && repoIssue(owner, name) === null;

/**
 * The GitHub name a folder suggests: "Mefi's Studio AI+" -> "Mefis-Studio-AI".
 * Apostrophes vanish, accents fold, anything else GitHub refuses becomes one
 * hyphen, and the result is trimmed to 100 without a trailing dot, hyphen or
 * ".git". Empty when nothing usable is left (a name in another script).
 */
function repoName(folderName) {
  let name = String(folderName ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .replace(/['‘’ʼ`]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/-{2,}/g, "-");
  // Dots, hyphens and ".git" come off the ends until nothing more does; cutting to 100 can uncover another.
  const settle = () => {
    let before;
    do {
      before = name;
      name = name.replace(/\.git$/i, "").replace(/^[-.]+/, "").replace(/[-.]+$/, "");
    } while (name !== before);
  };
  settle();
  name = name.slice(0, 100);
  settle();
  return name;
}

/** Other names to offer when one is taken: name-2, name-3, name-app (never a taken one). */
function nameSuggestions(name, taken = []) {
  const base = repoName(name);
  if (!base) return [];
  const used = new Set([...taken].map((item) => String(item).toLowerCase()));
  const out = [];
  for (const suffix of ["-2", "-3", "-app", "-4"]) {
    const candidate = `${base.slice(0, 100 - suffix.length).replace(/[-.]+$/, "")}${suffix}`;
    if (validRepo("owner", candidate) && !used.has(candidate.toLowerCase())) out.push(candidate);
    if (out.length === 3) break;
  }
  return out;
}

// ---- what a new project starts with ------------------------------------------
const IGNORE_BASE = Object.freeze([
  "# Dependencies and build output", "node_modules/", "dist/",
  "", "# Local credentials and environment: these stay on this PC",
  ".env", ".env.*", "!.env.example", "auth.json", "credentials.json", "secrets/", "*.pem", "*.key",
  "", "# Logs, databases and editor leftovers",
  "*.log", "*.db", ".DS_Store", "Thumbs.db", "desktop.ini", ".vscode/", ".idea/", "*.swp",
]);
const IGNORE_STACKS = Object.freeze({
  node: ["coverage/", "npm-debug.log*", "yarn-error.log*"],
  python: ["__pycache__/", "*.pyc", ".venv/", "venv/", ".pytest_cache/", "*.egg-info/", "build/"],
  love: ["*.love", "build/"],
});

/** The .gitignore written before the first commit: the baseline plus one block per detected stack (node, python, love). */
function gitignoreFor(stacks = []) {
  const lines = [...IGNORE_BASE];
  const seen = new Set();
  for (const raw of Array.isArray(stacks) ? stacks : []) {
    const stack = String(raw ?? "").toLowerCase();
    if (!IGNORE_STACKS[stack] || seen.has(stack)) continue;
    seen.add(stack);
    lines.push("", `# ${stack === "love" ? "LOVE" : stack === "node" ? "Node.js" : "Python"}`, ...IGNORE_STACKS[stack]);
  }
  return `# Written by Mefi's Studio AI+ before the first commit. Edit it freely.\n\n${lines.join("\n")}\n`;
}

const MIT = [
  "MIT License",
  "",
  "Copyright (c) {notice}",
  "",
  "Permission is hereby granted, free of charge, to any person obtaining a copy",
  "of this software and associated documentation files (the \"Software\"), to deal",
  "in the Software without restriction, including without limitation the rights",
  "to use, copy, modify, merge, publish, distribute, sublicense, and/or sell",
  "copies of the Software, and to permit persons to whom the Software is",
  "furnished to do so, subject to the following conditions:",
  "",
  "The above copyright notice and this permission notice shall be included in all",
  "copies or substantial portions of the Software.",
  "",
  "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR",
  "IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,",
  "FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE",
  "AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER",
  "LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,",
  "OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE",
  "SOFTWARE.",
  "",
].join("\n");

// The Apache License, Version 2.0, as GitHub's own license template has it; its
// appendix notice is the one line that names a year and a holder.
const APACHE_2 = `                                 Apache License
                           Version 2.0, January 2004
                        http://www.apache.org/licenses/

   TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

   1. Definitions.

      "License" shall mean the terms and conditions for use, reproduction,
      and distribution as defined by Sections 1 through 9 of this document.

      "Licensor" shall mean the copyright owner or entity authorized by
      the copyright owner that is granting the License.

      "Legal Entity" shall mean the union of the acting entity and all
      other entities that control, are controlled by, or are under common
      control with that entity. For the purposes of this definition,
      "control" means (i) the power, direct or indirect, to cause the
      direction or management of such entity, whether by contract or
      otherwise, or (ii) ownership of fifty percent (50%) or more of the
      outstanding shares, or (iii) beneficial ownership of such entity.

      "You" (or "Your") shall mean an individual or Legal Entity
      exercising permissions granted by this License.

      "Source" form shall mean the preferred form for making modifications,
      including but not limited to software source code, documentation
      source, and configuration files.

      "Object" form shall mean any form resulting from mechanical
      transformation or translation of a Source form, including but
      not limited to compiled object code, generated documentation,
      and conversions to other media types.

      "Work" shall mean the work of authorship, whether in Source or
      Object form, made available under the License, as indicated by a
      copyright notice that is included in or attached to the work
      (an example is provided in the Appendix below).

      "Derivative Works" shall mean any work, whether in Source or Object
      form, that is based on (or derived from) the Work and for which the
      editorial revisions, annotations, elaborations, or other modifications
      represent, as a whole, an original work of authorship. For the purposes
      of this License, Derivative Works shall not include works that remain
      separable from, or merely link (or bind by name) to the interfaces of,
      the Work and Derivative Works thereof.

      "Contribution" shall mean any work of authorship, including
      the original version of the Work and any modifications or additions
      to that Work or Derivative Works thereof, that is intentionally
      submitted to Licensor for inclusion in the Work by the copyright owner
      or by an individual or Legal Entity authorized to submit on behalf of
      the copyright owner. For the purposes of this definition, "submitted"
      means any form of electronic, verbal, or written communication sent
      to the Licensor or its representatives, including but not limited to
      communication on electronic mailing lists, source code control systems,
      and issue tracking systems that are managed by, or on behalf of, the
      Licensor for the purpose of discussing and improving the Work, but
      excluding communication that is conspicuously marked or otherwise
      designated in writing by the copyright owner as "Not a Contribution."

      "Contributor" shall mean Licensor and any individual or Legal Entity
      on behalf of whom a Contribution has been received by Licensor and
      subsequently incorporated within the Work.

   2. Grant of Copyright License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      copyright license to reproduce, prepare Derivative Works of,
      publicly display, publicly perform, sublicense, and distribute the
      Work and such Derivative Works in Source or Object form.

   3. Grant of Patent License. Subject to the terms and conditions of
      this License, each Contributor hereby grants to You a perpetual,
      worldwide, non-exclusive, no-charge, royalty-free, irrevocable
      (except as stated in this section) patent license to make, have made,
      use, offer to sell, sell, import, and otherwise transfer the Work,
      where such license applies only to those patent claims licensable
      by such Contributor that are necessarily infringed by their
      Contribution(s) alone or by combination of their Contribution(s)
      with the Work to which such Contribution(s) was submitted. If You
      institute patent litigation against any entity (including a
      cross-claim or counterclaim in a lawsuit) alleging that the Work
      or a Contribution incorporated within the Work constitutes direct
      or contributory patent infringement, then any patent licenses
      granted to You under this License for that Work shall terminate
      as of the date such litigation is filed.

   4. Redistribution. You may reproduce and distribute copies of the
      Work or Derivative Works thereof in any medium, with or without
      modifications, and in Source or Object form, provided that You
      meet the following conditions:

      (a) You must give any other recipients of the Work or
          Derivative Works a copy of this License; and

      (b) You must cause any modified files to carry prominent notices
          stating that You changed the files; and

      (c) You must retain, in the Source form of any Derivative Works
          that You distribute, all copyright, patent, trademark, and
          attribution notices from the Source form of the Work,
          excluding those notices that do not pertain to any part of
          the Derivative Works; and

      (d) If the Work includes a "NOTICE" text file as part of its
          distribution, then any Derivative Works that You distribute must
          include a readable copy of the attribution notices contained
          within such NOTICE file, excluding those notices that do not
          pertain to any part of the Derivative Works, in at least one
          of the following places: within a NOTICE text file distributed
          as part of the Derivative Works; within the Source form or
          documentation, if provided along with the Derivative Works; or,
          within a display generated by the Derivative Works, if and
          wherever such third-party notices normally appear. The contents
          of the NOTICE file are for informational purposes only and
          do not modify the License. You may add Your own attribution
          notices within Derivative Works that You distribute, alongside
          or as an addendum to the NOTICE text from the Work, provided
          that such additional attribution notices cannot be construed
          as modifying the License.

      You may add Your own copyright statement to Your modifications and
      may provide additional or different license terms and conditions
      for use, reproduction, or distribution of Your modifications, or
      for any such Derivative Works as a whole, provided Your use,
      reproduction, and distribution of the Work otherwise complies with
      the conditions stated in this License.

   5. Submission of Contributions. Unless You explicitly state otherwise,
      any Contribution intentionally submitted for inclusion in the Work
      by You to the Licensor shall be under the terms and conditions of
      this License, without any additional terms or conditions.
      Notwithstanding the above, nothing herein shall supersede or modify
      the terms of any separate license agreement you may have executed
      with Licensor regarding such Contributions.

   6. Trademarks. This License does not grant permission to use the trade
      names, trademarks, service marks, or product names of the Licensor,
      except as required for reasonable and customary use in describing the
      origin of the Work and reproducing the content of the NOTICE file.

   7. Disclaimer of Warranty. Unless required by applicable law or
      agreed to in writing, Licensor provides the Work (and each
      Contributor provides its Contributions) on an "AS IS" BASIS,
      WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
      implied, including, without limitation, any warranties or conditions
      of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or FITNESS FOR A
      PARTICULAR PURPOSE. You are solely responsible for determining the
      appropriateness of using or redistributing the Work and assume any
      risks associated with Your exercise of permissions under this License.

   8. Limitation of Liability. In no event and under no legal theory,
      whether in tort (including negligence), contract, or otherwise,
      unless required by applicable law (such as deliberate and grossly
      negligent acts) or agreed to in writing, shall any Contributor be
      liable to You for damages, including any direct, indirect, special,
      incidental, or consequential damages of any character arising as a
      result of this License or out of the use or inability to use the
      Work (including but not limited to damages for loss of goodwill,
      work stoppage, computer failure or malfunction, or any and all
      other commercial damages or losses), even if such Contributor
      has been advised of the possibility of such damages.

   9. Accepting Warranty or Additional Liability. While redistributing
      the Work or Derivative Works thereof, You may choose to offer,
      and charge a fee for, acceptance of support, warranty, indemnity,
      or other liability obligations and/or rights consistent with this
      License. However, in accepting such obligations, You may act only
      on Your own behalf and on Your sole responsibility, not on behalf
      of any other Contributor, and only if You agree to indemnify,
      defend, and hold each Contributor harmless for any liability
      incurred by, or claims asserted against, such Contributor by reason
      of your accepting any such warranty or additional liability.

   END OF TERMS AND CONDITIONS

   APPENDIX: How to apply the Apache License to your work.

      To apply the Apache License to your work, attach the following
      boilerplate notice, with the fields enclosed by brackets "[]"
      replaced with your own identifying information. (Don't include
      the brackets!)  The text should be enclosed in the appropriate
      comment syntax for the file format. We also recommend that a
      file or class name and description of purpose be included on the
      same "printed page" as the copyright notice for easier
      identification within third-party archives.

   Copyright {notice}

   Licensed under the Apache License, Version 2.0 (the "License");
   you may not use this file except in compliance with the License.
   You may obtain a copy of the License at

       http://www.apache.org/licenses/LICENSE-2.0

   Unless required by applicable law or agreed to in writing, software
   distributed under the License is distributed on an "AS IS" BASIS,
   WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
   See the License for the specific language governing permissions and
   limitations under the License.
`;

const LICENSES = Object.freeze({ none: "", mit: MIT, "apache-2.0": APACHE_2 });
const LICENSE_IDS = Object.freeze(["none", "mit", "apache-2.0"]);

/** A license file's text with the copyright year and holder filled in; "" for none, null for an id Studio does not know. */
function licenseText(id, { holder = "", year = null } = {}) {
  const template = LICENSES[String(id ?? "").toLowerCase()];
  if (template === undefined) return null;
  const notice = [Number.isInteger(year) && year > 0 ? String(year) : "", String(holder ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim()].filter(Boolean).join(" ") || "the authors";
  return template.replace("{notice}", () => notice);
}

// ---- what a failure means ----------------------------------------------------
const NETWORK_FAILURE = /could not resolve (host|proxy)|failed to connect|connection (timed out|refused|reset)|operation timed out|network is unreachable|no route to host|temporary failure in name resolution|recv failure|early eof|ssl_(error|connect)|getaddrinfo|enotfound|etimedout|econnreset|econnrefused|error connecting to|dial tcp|no such host|check your internet connection|connection was reset|forcibly closed by the remote host|ssl_(?:read|write)|context deadline exceeded|i\/o timeout|wsa(?:recv|send)/i;
// GitHub's push protection names the secret between dashes ("—— GitHub Personal
// Access Token ——") and the file on a later "path: file:line" line.
const SECRET_LABEL = /[—―]{2,}\s*([^—―\r\n]*[^\s—―])\s*[—―]{2,}/;
const SECRET_PATH = /path:\s*(\S{1,500}?)(?::\d+)?(?:\s|$)/i;
const LARGE_FILE = /File\s+(.{1,500}?)\s+is\s+([\d.]+)\s*Mi?B\b/i;
// What a classifier reads of a failure: the end of it (a closing error line is the one that names the reason), so a
// megabyte of output cannot hold the app up in a pattern that rescans a long line from each of its words.
const RAW_CAP = 20000;
const tailOf = (value) => { const whole = scrub(value); return whole.length > RAW_CAP ? whole.slice(-RAW_CAP) : whole; };

/**
 * What `git push` said, as { kind, text, fix, state, detail } (plus file, label
 * or mb when the output names them). `fix` is an action id: pull, sign-in,
 * add-permission, push-branch, leave-out, leave-out-ignore, link, retry, wait
 * or details. `state` is the chip state the failure lands in.
 */
function classifyPush(stderr, { timedOut = false, branch = "" } = {}) {
  const raw = tailOf(stderr);
  const detail = usefulLine(raw);
  const done = (kind, sentence, fix, extra = {}) => ({ kind, text: sentence, fix, state: PUSH_STATE[kind] ?? null, detail, ...extra });
  if (timedOut) return { kind: "timeout", text: "Still uploading.", fix: "wait", state: null, detail };
  if (NETWORK_FAILURE.test(raw)) return done("offline", "GitHub could not be reached. Nothing was pushed.", "retry");
  if (/refusing to allow (?:an? )?[^`]*to create or update workflow|without `?workflow`? scope/i.test(raw)) return done("workflow-scope", "Your GitHub sign-in cannot push workflow files.", "add-permission");
  if (/GITHUB PUSH PROTECTION|push cannot contain secrets|secret scanning/i.test(raw)) {
    const label = SECRET_LABEL.exec(raw)?.[1]?.trim() || "";
    const file = SECRET_PATH.exec(raw)?.[1] ?? "";
    return done("secret", `Stopped: ${label ? article(label) : "a secret"} in ${file || "this push"}.`, "leave-out", { file, label });
  }
  if (/GH001|Large files detected|exceeds GitHub's file size limit/i.test(raw)) {
    // git prints a warning line for every file over 50 MB before the error for the one over 100 MB: name the one GitHub refuses.
    const sizes = [...raw.matchAll(new RegExp(LARGE_FILE.source, "gi"))];
    const found = sizes.find((item) => Number(item[2]) > 100) ?? sizes.find((item) => /error:\s*$/i.test(raw.slice(0, item.index))) ?? sizes[0];
    const mb = found ? Math.round(Number(found[2])) : null;
    return done("too-large", found ? `${found[1]} is ${mb} MB; GitHub refuses files over 100 MB.` : "A file in this push is over GitHub's 100 MB limit.", "leave-out-ignore", found ? { file: found[1], mb } : {});
  }
  if (/non-fast-forward|\(fetch first\)|Updates were rejected because|tip of your current branch is behind|Note about fast-forwards/i.test(raw)) return done("non-fast-forward", "GitHub has newer work. Pull first.", "pull");
  if (/GH006|protected branch (?:hook )?declined|Protected branch update failed|GH013|Repository rule violations|Changes must be made through a pull request|required status check/i.test(raw)) {
    const named = /refs\/heads\/([^\s'":]+)/.exec(raw)?.[1]?.replace(/[.,;)]+$/, "") || /\]\s+\S+\s+->\s+(\S+)/.exec(raw)?.[1];
    return done("protected-branch", `GitHub does not allow direct pushes to ${text(branch) || named || "this branch"}.`, "push-branch");
  }
  if (/Repository not found|repository '[^']*' not found/i.test(raw)) return done("not-found", "GitHub could not find this project's repository. It may have been renamed or removed.", "link"); // proposed
  if (/Authentication failed|could not read (?:Username|Password)|terminal prompts disabled|Permission to .+ denied|Invalid username or password|Bad credentials|requested URL returned error: 40[13]|Write access to repository not granted|Permission denied \(publickey\)|HTTP 401|Could not read from remote repository/i.test(raw)) return done("auth", "GitHub did not accept this PC's sign-in.", "sign-in");
  return done("unknown", detail ? `GitHub refused the push: ${detail}` : "GitHub refused the push.", "details");
}

/**
 * What `gh` (or the git it starts) said while making, listing or reading a
 * repository, as { kind, text, fix, detail }. `repo` ("owner/name") and
 * `action: "create"` only sharpen the sentence. The organization and SSO
 * strings are best guesses: gh's wording there is not verified.
 */
function classifyGh(stderr, { repo = "", action = "", scope = "" } = {}) {
  const raw = tailOf(stderr);
  const detail = usefulLine(raw);
  const done = (kind, sentence, fix, extra = {}) => ({ kind, text: sentence, fix, detail, ...extra });
  if (/spawn gh(?:\.exe)? ENOENT|['"]?gh(?:\.exe)?['"]? is not recognized|gh: (?:command )?not found/i.test(raw)) return done("gh-missing", "GitHub CLI is not installed on this PC.", "install-gh");
  if (/spawn git(?:\.exe)? ENOENT|['"]?git(?:\.exe)?['"]? is not recognized|git: (?:command )?not found/i.test(raw)) return done("git-missing", "Git is not installed.", "install-git");
  if (NETWORK_FAILURE.test(raw)) return done("offline", action === "create" ? "You're offline. Nothing was created." : "GitHub could not be reached.", "retry");
  if (/name already exists|already exists on this account|repositor(?:y|ies)[^\n]*already exists/i.test(raw)) return done("name-taken", repo ? `${repo} already exists. Link to it, or pick another name.` : "That name is already taken on GitHub. Link to it, or pick another name.", "link");
  const missing = /missing required scopes?[^\n]*?\[([^\]]+)\]|needs the "([^"]+)" scope|refresh[^\n]*?-s\s+(\S+)/i.exec(raw);
  if (missing) {
    const need = (missing[1] || missing[2] || missing[3] || scope).replace(/["']/g, "");
    return done("missing-scope", need === "workflow" ? "Your GitHub sign-in cannot push workflow files." : "Your GitHub sign-in needs one more permission.", "add-permission", { scope: need });
  }
  if (/SAML|\bSSO\b|Resource protected by organization|authorize (?:the|your|this)/i.test(raw)) return done("sso", "This organization asks you to authorize Studio's GitHub sign-in first.", "details"); // proposed
  if (/not logged in|not logged into any GitHub hosts|gh auth login|To get started with GitHub CLI|HTTP 401|Bad credentials|authentication (?:required|failed)|GH_TOKEN/i.test(raw)) return done("not-signed-in", "Sign in to GitHub first.", "sign-in");
  if (/rate limit|abuse detection|HTTP 429|too many requests/i.test(raw)) return done("rate-limit", "GitHub asked Studio to slow down. Try again in a few minutes.", "retry"); // proposed
  if (/cannot create a repository for|not allowed to create|permission to create|must be a member of the organization|does not have the correct permissions to execute/i.test(raw)) return done("org-permission", "You can't create repositories in that organization. Pick your own account or another owner.", "pick-owner"); // proposed
  if (/HTTP 403|Resource not accessible|Forbidden/i.test(raw)) return done("forbidden", "GitHub did not accept this PC's sign-in.", "sign-in");
  if (/name is invalid|invalid repository name|Repository creation failed|Unprocessable|HTTP 422/i.test(raw)) return done("invalid-name", "GitHub does not accept that name.", "rename"); // proposed
  if (/Could not resolve to a Repository|HTTP 404|Not Found|Repository not found/i.test(raw)) return done("not-found", "GitHub could not find that repository.", "link"); // proposed
  return done("unknown", detail ? `GitHub said: ${detail}` : "GitHub did not accept that.", "details"); // proposed
}

// ---- paths that never belong in a commit ---------------------------------------
const ENV_TEMPLATE = /^\.env\.(?:example|sample|template|dist)$/i;
const SECRET_NAMES = [
  { rule: ".env*", label: "an environment file", test: (name) => /^\.env/i.test(name) && !ENV_TEMPLATE.test(name) },
  { rule: "*.pem", label: "a private key file", test: (name) => /\.pem$/i.test(name) },
  { rule: "*.key", label: "a private key file", test: (name) => /\.key$/i.test(name) },
  { rule: "id_rsa*", label: "a private key file", test: (name) => /^id_(?:rsa|dsa|ecdsa|ed25519)/i.test(name) },
  { rule: "auth.json", label: "a saved sign-in file", test: (name) => /^auth\.json$/i.test(name) },
  { rule: "credentials.json", label: "a saved sign-in file", test: (name) => /^credentials\.json$/i.test(name) },
  // Sign-in files tools write into a home folder, and key stores: the ones that turn up in a project folder by accident.
  { rule: ".netrc", label: "a saved sign-in file", test: (name) => /^[._]netrc$/i.test(name) },
  { rule: ".git-credentials", label: "a saved sign-in file", test: (name) => /^\.git-credentials$/i.test(name) },
  { rule: ".pypirc", label: "a saved sign-in file", test: (name) => /^\.pypirc$/i.test(name) },
  { rule: ".pgpass", label: "a saved sign-in file", test: (name) => /^\.pgpass$/i.test(name) },
  { rule: ".htpasswd", label: "a saved sign-in file", test: (name) => /^\.htpasswd$/i.test(name) },
  { rule: "*.pfx", label: "a private key file", test: (name) => /\.(?:pfx|p12)$/i.test(name) },
  { rule: "*.ppk", label: "a private key file", test: (name) => /\.ppk$/i.test(name) },
  { rule: "*.keystore", label: "a private key file", test: (name) => /\.(?:keystore|jks)$/i.test(name) },
];
// Folders whose whole content is credentials, by name (a file inside one that has a name of its own is named for that first).
const SECRETS_FOLDER = /^\.?secrets$/i;
const CREDENTIAL_FOLDER = /^\.(?:ssh|aws|gnupg)$/i;
// Windows opens "server.pem." and "server.pem " as server.pem, and "server.pem::$DATA" as its content: judge the name it ends up as.
const settled = (part) => part.replace(/::\$[A-Za-z_]+$/, "").replace(/[. ]+$/, "") || part;

/**
 * Whether a project-relative path is one Studio leaves out of a commit by name:
 * null when it may go in, else { kind, rule, label }. kind "secret" is a stop
 * ("Stopped: <label> in <file>."); kind "generated" (node_modules/, dist/) is
 * simply kept out, as the starting .gitignore does.
 */
function pathBlocked(relPath) {
  const parts = text(relPath).replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").split("/").filter(Boolean).map(settled);
  if (!parts.length) return null;
  const isDirectory = /[\\/]$/.test(text(relPath));
  const folders = isDirectory ? parts : parts.slice(0, -1);
  const name = isDirectory ? "" : parts.at(-1);
  for (const folder of folders) {
    if (SECRETS_FOLDER.test(folder)) return { kind: "secret", rule: "secrets/", label: "a secrets folder" };
  }
  const hit = name ? SECRET_NAMES.find((entry) => entry.test(name)) : null;
  if (hit) return { kind: "secret", rule: hit.rule, label: hit.label };
  for (const folder of folders) {
    if (CREDENTIAL_FOLDER.test(folder)) return { kind: "secret", rule: `${folder.toLowerCase()}/`, label: "a credentials folder" };
  }
  // Windows folds case: Node_Modules and DIST are the same folders.
  for (const folder of folders) {
    if (/^node_modules$/i.test(folder)) return { kind: "generated", rule: "node_modules/", label: "installed packages" };
    if (/^dist$/i.test(folder)) return { kind: "generated", rule: "dist/", label: "build output" };
  }
  return null;
}

/**
 * Whether a folder is inside a OneDrive folder: under any of the OneDrive,
 * OneDriveConsumer or OneDriveCommercial paths in `env`, else by a folder
 * named OneDrive (or "OneDrive - <organization>") in the path.
 */
function oneDrive(absPath, env = {}) {
  const norm = (value) => String(value ?? "").replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const target = norm(absPath);
  if (!target) return false;
  for (const [key, value] of Object.entries(env && typeof env === "object" ? env : {})) {
    if (!/^onedrive(?:consumer|commercial)?$/i.test(key)) continue;
    const root = norm(value);
    if (root && (target === root || target.startsWith(`${root}/`))) return true;
  }
  return /(?:^|\/)onedrive(?: - [^/]+)?(?:\/|$)/.test(target);
}

/** The message a save gets when the owner leaves it empty. */
const saveMessage = (files) => (count(files) ? `Studio save: ${plural(count(files), "file")}` : "Studio save");

// ---- publishing ---------------------------------------------------------------
// The fixed steps of "Publish to GitHub", in order, as data: the executor in
// scripts/git-actions.cjs runs them without a shell and stops at the first that
// fails, so a later run picks up from what is already true. Each step names the
// stage the dialog shows ("Saving a first commit", "Creating owner/name",
// "Uploading"), and the argv (git or gh, no shell) or the file it writes.
const FIRST_MESSAGE = "First commit from Studio";
const DESCRIPTION_MAX = 350;
const STAGE_LABEL = { saving: "Saving a first commit", creating: "Creating {repo}", uploading: "Uploading" };

/**
 * The publish plan for one folder, or why there is none:
 *   { ok: true, repo, visibility, stages: [{ id, label }], steps: [...] }
 *   { ok: false, kind, error }
 * `kind` is name, visibility, confirm-public, license, has-remote or detached.
 * A public repository needs `confirmPublic` to be exactly "owner/name" (the
 * host enforces it by calling this). An existing origin is never replaced.
 * Step kinds: git and gh (argv), write (a file, unless one is there already)
 * and save (a path-limited first commit: "previewed" files or the "written" ones).
 */
function publishPlan({
  owner, name, visibility = "private", description = "", gitignore = true, license = "none", holder = "", year = null, stacks = [],
  confirmPublic = "", isRepo = false, unborn = false, hasCommits = false, branch = null, detached = false, hasRemote = false,
} = {}) {
  const problem = repoIssue(owner, name);
  if (problem) return { ok: false, kind: "name", error: problem };
  const repo = `${owner}/${name}`;
  if (visibility !== "private" && visibility !== "public") return { ok: false, kind: "visibility", error: "Choose who can see it." };
  if (visibility === "public" && String(confirmPublic ?? "").trim() !== repo) return { ok: false, kind: "confirm-public", error: `Type ${repo} to make it public.` };
  const licenseId = String(license ?? "none").toLowerCase();
  if (!LICENSE_IDS.includes(licenseId)) return { ok: false, kind: "license", error: "Choose None, MIT or Apache-2.0." };
  if (hasRemote) return { ok: false, kind: "has-remote", error: "This project already has a GitHub address. Studio never replaces it." };
  if (isRepo && detached && hasCommits) return { ok: false, kind: "detached", error: "This checkout is not on a branch. Start a branch here, then publish." };

  const steps = [];
  const add = (step) => steps.push({ timeoutMs: 30000, ...step });
  if (!isRepo) add({ id: "init", stage: "saving", label: "Starting Git in the folder", kind: "git", argv: ["init", "-b", "main"] });
  else if (unborn && branch !== "main") add({ id: "init", stage: "saving", label: "Naming the branch main", kind: "git", argv: ["symbolic-ref", "HEAD", "refs/heads/main"] });
  else if (hasCommits && branch !== "main") add({ id: "init", stage: "saving", label: "Naming the branch main", kind: "git", argv: ["branch", "-M", "main"] });
  const writes = [];
  if (gitignore) { add({ id: "ignore", stage: "saving", label: "Writing .gitignore", kind: "write", path: ".gitignore", text: gitignoreFor(stacks), skipIfExists: true }); writes.push(".gitignore"); }
  if (licenseId !== "none") { add({ id: "license", stage: "saving", label: "Writing LICENSE", kind: "write", path: "LICENSE", text: licenseText(licenseId, { holder, year }), skipIfExists: true }); writes.push("LICENSE"); }
  if (!hasCommits) add({ id: "save", stage: "saving", label: "Saving a first commit", kind: "save", paths: "previewed", message: FIRST_MESSAGE });
  else if (writes.length) add({ id: "save", stage: "saving", label: `Saving ${writes.join(" and ")}`, kind: "save", paths: "written", message: `Add ${writes.join(" and ")}` });
  const about = String(description ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, DESCRIPTION_MAX);
  add({
    id: "create", stage: "creating", label: `Creating ${repo}`, kind: "gh", timeoutMs: 120000,
    argv: ["repo", "create", repo, visibility === "public" ? "--public" : "--private", "--source", ".", "--remote", "origin", ...(about ? ["--description", about] : [])],
  });
  add({ id: "push", stage: "uploading", label: "Uploading", kind: "git", timeoutMs: 600000, argv: ["push", "-u", "origin", "main"] });
  add({ id: "fetch", stage: "uploading", label: "Checking GitHub has it", kind: "git", argv: ["fetch", "origin", "--prune"] });
  add({ id: "upstream", stage: "uploading", label: "Linking main to GitHub", kind: "git", argv: ["branch", "--set-upstream-to=origin/main", "main"] });

  const stages = ["saving", "creating", "uploading"].filter((id) => steps.some((step) => step.stage === id)).map((id) => ({ id, label: fill(STAGE_LABEL[id], { repo }) }));
  return { ok: true, repo, visibility, stages, steps };
}

module.exports = {
  STATES, STATE_IDS, OUTCOMES, ACTION_IDS, LICENSE_IDS,
  describe, chip,
  repoName, validRepo, repoIssue, nameSuggestions,
  gitignoreFor, licenseText,
  classifyPush, classifyGh, scrub,
  pathBlocked, oneDrive, saveMessage,
  publishPlan, FIRST_MESSAGE,
};
