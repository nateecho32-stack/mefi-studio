import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";

// scripts/git-link.cjs is the GitHub link's shared vocabulary and rules: the
// frozen state table, the chip model built from a glance, the last sync, the
// account and what is running, the repository-name and path rules, the
// .gitignore and license text, what git and gh failures mean, and the fixed
// steps of a publish. Pure: nothing here touches git, gh, disk or the clock.
const require = createRequire(import.meta.url);
const git = require("../scripts/git-link.cjs");
const { STATES, STATE_IDS } = git;
const ROWS = Object.values(STATES);

const read = async (file) => (await readFile(new URL(`../${file}`, import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const ELLIPSIS = "\u2026";

// ---- the vocabulary ----------------------------------------------------------
// Design brief section 3, in its order: id, chip label, tone, glyph name (the
// names of the drawings in the component kit's section 3.1).
const TABLE = [
  ["not-repo", "Not a repo", "neutral"],
  ["no-commits", "No commits yet", "neutral"],
  ["no-remote", "Only on this PC", "neutral"],
  ["other-remote", "Linked elsewhere", "neutral"],
  ["signed-out", "Sign in", "warn"],
  ["checking", `Checking${ELLIPSIS}`, "neutral"],
  ["in-sync", "In sync", "good"],
  ["ahead", "{n} to push", "info"],
  ["behind", "{n} to pull", "info"],
  ["diverged", "Both changed", "warn"],
  ["uncommitted", "{n} changes", "info"],
  ["other-branch", "On {branch}", "warn"],
  ["no-upstream", "Not pushed yet", "info"],
  ["offline", "Offline", "neutral"],
  ["fetch-failed", "Can't check GitHub", "bad"],
  ["agents-working", "Agents building", "info"],
  ["saving", `Saving${ELLIPSIS}`, "info"],
  ["pushing", `Pushing${ELLIPSIS}`, "info"],
  ["pulling", `Pulling${ELLIPSIS}`, "info"],
  ["publishing", `Publishing${ELLIPSIS}`, "info"],
  ["check-failed", "Check failed", "bad"],
  ["lost-work", "Held back", "bad"],
  ["conflict", "Needs merging", "bad"],
  ["push-refused", "GitHub said no", "bad"],
  ["blocked-secret", "Stopped", "bad"],
  ["too-large", "File too big", "warn"],
  ["folder-missing", "Folder missing", "warn"],
  ["unknown", "Not checked", "neutral"],
  ["success", "Done", "good"],
  ["pull-refused", "Can't pull now", "warn"],
  ["error", "Sync did not run", "bad"],
];

// The `<!-- glyph: … -->` names of kit.md section 3.1 (one per state id).
const KIT_GLYPHS = [
  "not-repo", "no-commits", "no-remote", "other-remote", "signed-out", "checking", "in-sync", "ahead", "behind", "diverged", "uncommitted",
  "other-branch", "no-upstream", "offline", "fetch-failed", "agents-working", "saving", "pushing", "pulling", "publishing", "check-failed",
  "lost-work", "conflict", "push-refused", "blocked-secret", "too-large", "folder-missing", "unknown", "success", "pull-refused", "error",
];

test("every state of the brief's vocabulary is in the frozen table with its label, tone and glyph", () => {
  assert.equal(TABLE.length, 31);
  assert.deepEqual([...STATE_IDS], TABLE.map(([id]) => id));
  assert.deepEqual(Object.keys(STATES), TABLE.map(([id]) => id));
  for (const [id, label, tone] of TABLE) {
    const row = STATES[id];
    assert.ok(row, id);
    assert.equal(row.label, label, `${id} label`);
    assert.equal(row.tone, tone, `${id} tone`);
    assert.equal(row.glyph, id, `${id} glyph is its own drawing`);
    assert.ok(row.sentence.length > 8, `${id} sentence`);
  }
  assert.equal(new Set(STATE_IDS).size, 31);
});

test("the table is frozen all the way down", () => {
  assert.ok(Object.isFrozen(STATES));
  for (const row of ROWS) {
    assert.ok(Object.isFrozen(row), row.id);
    if (row.primary) assert.ok(Object.isFrozen(row.primary), row.id);
    if (row.secondary) assert.ok(Object.isFrozen(row.secondary), row.id);
  }
  assert.throws(() => { "use strict"; STATES.ahead.tone = "bad"; }, TypeError);
  assert.throws(() => { "use strict"; STATES.extra = {}; }, TypeError);
  assert.throws(() => { "use strict"; STATES.ahead = {}; }, TypeError);
  assert.ok(Object.isFrozen(git.OUTCOMES));
  assert.ok(Object.isFrozen(git.ACTION_IDS));
});

test("the glyph names match the component kit's state glyphs (kit.md section 3.1)", async () => {
  assert.deepEqual(ROWS.map((row) => row.glyph), KIT_GLYPHS);
  // With the design scratchpad at hand (MEFI_KIT_MD=<path to kit.md>), the names are read from the kit itself.
  if (!process.env.MEFI_KIT_MD) return;
  const kit = (await readFile(process.env.MEFI_KIT_MD, "utf8")).replace(/\r\n/g, "\n");
  const section = kit.slice(kit.indexOf("### 3.1 State glyphs"), kit.indexOf("### 3.2 UI glyphs"));
  const names = [...section.matchAll(/<!-- glyph: ([a-z-]+) -->/g)].map((match) => match[1]);
  assert.deepEqual(ROWS.map((row) => row.glyph), names);
});

test("every action a row offers is an action id the host can map, and rows carry no emoji or exclamation marks", () => {
  for (const row of ROWS) {
    for (const action of [row.primary, row.secondary]) {
      if (!action) continue;
      assert.ok(git.ACTION_IDS.includes(action.id), `${row.id}: ${action.id}`);
      assert.match(action.label, /^[A-Z]/, `${row.id}: ${action.label}`);
    }
    for (const value of [row.label, row.sentence, row.primary?.label ?? "", row.secondary?.label ?? ""]) {
      assert.doesNotMatch(value, /!|\p{Extended_Pictographic}/u, `${row.id}: ${value}`);
    }
  }
  // The primaries the renderer maps to bridge calls (the build spec's list) all exist.
  for (const id of ["push", "pull", "publish", "sign-in", "save-and-push", "check", "rebase", "link", "find-folder", "retry", "open-github", "pull-anyway"]) {
    assert.ok(git.ACTION_IDS.includes(id), id);
  }
});

test("shipped sentences are word for word what scripts/sync.mjs and main.cjs already say", async () => {
  const sync = await read("scripts/sync.mjs");
  const main = await read("main.cjs");
  for (const piece of [
    "This project folder is not a Git repository, so there is nothing to sync.",
    "This PC matches GitHub ",
    "Some work on this PC is not on GitHub yet.",
    " this PC has not pulled yet.",
    " changed on this PC and on GitHub. Put this PC's commits on top of GitHub's, then sync.",
    " changed on this PC and on GitHub. Commit or set aside the uncommitted files, then put this PC's commits on top of GitHub's.",
    "GitHub could not be reached. Some work on this PC is not on GitHub yet.",
    "GitHub could not be reached. As of the last check, this PC matched GitHub.",
    "Sign in to GitHub again or check this project's GitHub address; nothing was changed.",
    "The project's check failed, so nothing was pushed. Fix it, then sync again.",
    "Nothing was changed; merge them by hand or ask Mefi.",
    "Restore them, or if that was deliberate say so with a \\\"Lost-work-ok: <why>\\\" line in a commit message.",
    "Could not fast-forward ",
    "(uncommitted edits in the way?): ",
    "This checkout is on ",
    "This project has no ${REMOTE} remote yet. Publish it to GitHub once to link your PCs.",
    "GitHub has no ${state.upstream} yet. Push ${state.main} once to link your PCs.",
    "Could not reach GitHub: ",
    "GitHub refused the push: ",
    "on top of GitHub's.",
  ]) assert.ok(sync.includes(piece), `scripts/sync.mjs no longer says: ${piece}`);
  assert.ok(main.includes("That project folder is unavailable. Reconnect it before switching."));
  assert.ok(main.includes("Sync could not run: "));

  assert.equal(STATES["not-repo"].sentence, "This project folder is not a Git repository, so there is nothing to sync.");
  assert.equal(STATES["in-sync"].sentence, "This PC matches GitHub {m}.");
  assert.equal(STATES["ahead"].sentence, "Some work on this PC is not on GitHub yet.");
  assert.equal(STATES["behind"].sentence, "GitHub has {behind} this PC has not pulled yet.");
  assert.equal(STATES["diverged"].sentence, "{m} changed on this PC and on GitHub. Put this PC's commits on top of GitHub's, then sync.");
  assert.equal(STATES["diverged"].dirtySentence, "{m} changed on this PC and on GitHub. Commit or set aside the uncommitted files, then put this PC's commits on top of GitHub's.");
  assert.equal(STATES["offline"].sentence, "GitHub could not be reached. Some work on this PC is not on GitHub yet.");
  assert.equal(STATES["offline"].cleanSentence, "GitHub could not be reached. As of the last check, this PC matched GitHub.");
  assert.equal(STATES["check-failed"].sentence, "The project's check failed, so nothing was pushed. Fix it, then sync again.");
  assert.equal(STATES["folder-missing"].sentence, "That project folder is unavailable. Reconnect it before switching.");
  // The friendlier no-remote and no-upstream sentences are proposed; the shipped ones stay beside them.
  assert.equal(STATES["no-remote"].shipped, "This project has no origin remote yet. Publish it to GitHub once to link your PCs.");
  assert.equal(STATES["no-upstream"].shipped, "GitHub has no origin/{m} yet. Push {m} once to link your PCs.");
});

test("proposed rows are marked proposed in the source and in the table", async () => {
  const source = await read("scripts/git-link.cjs");
  const proposed = ROWS.filter((row) => row.proposed).map((row) => row.id);
  assert.deepEqual(proposed, [
    "no-commits", "no-remote", "other-remote", "signed-out", "checking", "no-upstream", "agents-working", "saving", "pushing", "pulling", "publishing",
    "blocked-secret", "too-large", "unknown",
  ]);
  for (const id of proposed) {
    const from = source.indexOf(`id: "${id}",`);
    const row = source.slice(from, source.indexOf("\n  },", from));
    assert.match(row, /\/\/ proposed/, `${id} sentence is marked // proposed`);
  }
});

// ---- describe ------------------------------------------------------------------
const base = { isRepo: true, unborn: false, branch: "main", detached: false, dirty: 0, ahead: 0, behind: 0, upstream: "origin/main", remote: "nateecho32-stack/mefi-studio", onDefault: true, available: true };
const glance = (over = {}) => ({ ...base, ...over });
const problem = (kind, over = {}) => ({ kind, detail: "", ...over });
const syncOf = (problems = [], over = {}) => ({ ok: problems.length === 0, checkedAt: 1_800_000_000_000, problems, pending: [], actions: [], ...over });

const CASES = [
  ["in sync", { glance: glance() }, "in-sync"],
  ["two to push", { glance: glance({ ahead: 2 }) }, "ahead"],
  ["one to push", { glance: glance({ ahead: 1 }) }, "ahead"],
  ["three to pull", { glance: glance({ behind: 3 }) }, "behind"],
  ["one to pull", { glance: glance({ behind: 1 }) }, "behind"],
  ["both sides moved", { glance: glance({ ahead: 2, behind: 3 }) }, "diverged"],
  ["both sides moved with files", { glance: glance({ ahead: 2, behind: 3, dirty: 1 }) }, "diverged"],
  ["four uncommitted files", { glance: glance({ dirty: 4 }) }, "uncommitted"],
  ["one uncommitted file", { glance: glance({ dirty: 1 }) }, "uncommitted"],
  ["commits to push outrank files", { glance: glance({ ahead: 2, dirty: 4 }) }, "ahead"],
  ["commits to pull outrank files", { glance: glance({ behind: 2, dirty: 4 }) }, "behind"],
  ["to pull outranks to push only when diverged", { glance: glance({ ahead: 1, behind: 1 }) }, "diverged"],
  ["a branch that is not the default one", { glance: glance({ branch: "wip/site-rebuild", onDefault: false, upstream: "origin/wip/site-rebuild", ahead: 2 }) }, "other-branch"],
  ["behind on another branch is never a pull", { glance: glance({ branch: "wip/x", onDefault: false, upstream: "origin/wip/x", behind: 3 }) }, "other-branch"],
  ["detached", { glance: glance({ branch: "HEAD", detached: true, onDefault: false }) }, "other-branch"],
  ["an unborn repo is no commits, not detached", { glance: glance({ unborn: true, branch: "master", detached: false, upstream: null, remote: null, onDefault: true }) }, "no-commits"],
  ["an unborn repo that reads as HEAD is still no commits", { glance: glance({ unborn: true, branch: "HEAD", detached: false, upstream: null, remote: null }) }, "no-commits"],
  ["no remote", { glance: glance({ remote: null, upstream: null }) }, "no-remote"],
  ["a remote that is not GitHub", { glance: glance({ remote: "other", ahead: 3 }) }, "other-remote"],
  ["not a repository", { glance: { isRepo: false, available: true } }, "not-repo"],
  ["linked and signed out", { glance: glance(), account: null }, "signed-out"],
  ["no remote is not signed out", { glance: glance({ remote: null, upstream: null }), account: null }, "no-remote"],
  ["another remote is not signed out", { glance: glance({ remote: "other" }), account: null }, "other-remote"],
  ["not a repo is not signed out", { glance: { isRepo: false }, account: null }, "not-repo"],
  ["an account nobody asked about is not signed out", { glance: glance(), account: undefined }, "in-sync"],
  ["an account still being read is not signed out", { glance: glance(), account: { ok: false } }, "in-sync"],
  ["signed in", { glance: glance(), account: "nateecho32-stack" }, "in-sync"],
  ["the project asked for GitHub", { glance: glance({ remote: null, upstream: null }), account: null, project: { needsGitHub: true } }, "signed-out"],
  ["never pushed", { glance: glance({ upstream: null }) }, "no-upstream"],
  ["never pushed with files", { glance: glance({ upstream: null, dirty: 2 }) }, "no-upstream"],
  ["a master default branch is in sync", { glance: glance({ branch: "master", onDefault: true, upstream: "origin/master" }) }, "in-sync"],
  ["master when main is the default", { glance: glance({ branch: "master", onDefault: false, main: "main" }) }, "other-branch"],
  ["working outranks a problem", { glance: glance({ ahead: 1 }), sync: syncOf([problem("check-failed", { detail: "npm run check failed" })]), busy: "pushing" }, "pushing"],
  ["saving", { glance: glance({ dirty: 4 }), busy: "saving" }, "saving"],
  ["pulling", { glance: glance({ behind: 3 }), busy: "pulling" }, "pulling"],
  ["publishing", { glance: glance({ remote: null, upstream: null }), busy: "publishing" }, "publishing"],
  ["checking", { glance: glance(), busy: "checking" }, "checking"],
  ["a made-up busy word is ignored", { glance: glance(), busy: "flying" }, "in-sync"],
  ["a missing folder outranks everything", { glance: glance({ available: false, ahead: 1 }), busy: "pushing", sync: syncOf([problem("error")]) }, "folder-missing"],
  ["a problem outranks linking", { glance: glance({ upstream: null }), sync: syncOf([problem("fetch-failed", { detail: "fatal: Authentication failed" })]) }, "fetch-failed"],
  ["a problem outranks to push", { glance: glance({ ahead: 1 }), sync: syncOf([problem("check-failed", { detail: "npm run check failed" })]) }, "check-failed"],
  ["a fetch that could not reach GitHub", { glance: glance({ ahead: 1 }), sync: syncOf([problem("offline", { detail: "Could not resolve host: github.com" })], { ok: true }) }, "offline"],
  ["lost work outranks a failed check", { glance: glance({ ahead: 1 }), sync: syncOf([problem("check-failed"), problem("lost-work", { detail: "Nothing was pushed. Merge abc1234 (x) left out 3 lines of 1 file another branch changed (a). Restore them, or if that was deliberate say so with a \"Lost-work-ok: <why>\" line in a commit message.", findings: [] })]) }, "lost-work"],
  ["a rebase that hit a conflict", { glance: glance({ ahead: 1, behind: 1 }), sync: syncOf([problem("rebase-conflict", { files: ["a.js"] })]) }, "conflict"],
  ["a refused push", { glance: glance({ ahead: 1 }), sync: syncOf([problem("push-refused", { detail: "hint: See the 'Note about fast-forwards' in 'git push --help' for details." })]) }, "push-refused"],
  ["a refused pull", { glance: glance({ behind: 1, dirty: 2 }), sync: syncOf([problem("pull-refused", { detail: "error: Your local changes would be overwritten" })]) }, "pull-refused"],
  ["a host failure with nothing else known", { sync: { ok: false, headline: "Sync could not run: spawn git ENOENT", problems: [{ kind: "error" }], pending: [], actions: [] } }, "error"],
  ["a problem that no longer holds is history", { glance: glance({ ahead: 0 }), sync: syncOf([problem("push-refused", { detail: "x" }), problem("check-failed")]) }, "in-sync"],
  ["a stale divergence is history", { glance: glance({ ahead: 0, behind: 2 }), sync: syncOf([problem("rebase-conflict", { files: ["a.js"] })]) }, "behind"],
  ["a refused first push still stands with nothing to be ahead of", { glance: glance({ upstream: null }), sync: syncOf([problem("push-refused", { detail: "remote: Permission to o/n.git denied to x." })]) }, "push-refused"],
  ["builders still working when there is something to pull", { glance: glance({ behind: 2 }), agentsBuilding: true }, "agents-working"],
  ["builders do not change to push", { glance: glance({ ahead: 2 }), agentsBuilding: true }, "ahead"],
  ["a finished push", { glance: glance(), outcome: { kind: "pushed", commits: 2 } }, "success"],
  ["a finished action never hides a problem", { glance: glance({ ahead: 1 }), outcome: { kind: "pushed", commits: 1 }, sync: syncOf([problem("check-failed")]) }, "check-failed"],
  ["a made-up outcome is ignored", { glance: glance(), outcome: { kind: "levitated" } }, "in-sync"],
  ["a standing refusal that names a secret", { glance: glance({ ahead: 1 }), refusal: { kind: "secret", text: "Stopped: a private key in config/keys.txt.", file: "config/keys.txt", label: "private key" } }, "blocked-secret"],
  ["a standing refusal for a big file", { glance: glance({ ahead: 1 }), refusal: { kind: "too-large", text: "installer.exe is 62 MB; GitHub refuses files over 100 MB.", file: "installer.exe", mb: 62 } }, "too-large"],
  ["a timeout is calm, never a problem", { glance: glance({ ahead: 1 }), refusal: { kind: "timeout", text: "Still uploading." } }, "ahead"],
  ["nothing at all", {}, "unknown"],
  ["a glance nobody filled in", { glance: {} }, "unknown"],
  ["only the last sync is known", { sync: { ok: true, checkedAt: 5, problems: [], pending: [], state: { repo: true, remote: true, main: "main", upstream: "origin/main", hasUpstream: true, branch: "main", ahead: 2, behind: 0, dirty: 0 } } }, "ahead"],
  ["only the last sync is known, off the default branch", { sync: { ok: true, problems: [], pending: [], state: { repo: true, remote: true, main: "main", upstream: "origin/main", hasUpstream: true, branch: "wip/x", ahead: 0, behind: 0, dirty: 0 } } }, "other-branch"],
];

test("describe picks one state by priority for every combination", () => {
  assert.ok(CASES.length >= 25);
  for (const [name, input, id] of CASES) {
    const model = git.describe(input);
    assert.equal(model.id, id, `${name}: ${model.id} (${model.sentence})`);
    const row = STATES[id];
    assert.equal(model.tone, row.tone, `${name} tone`);
    assert.equal(model.glyph, row.glyph, `${name} glyph`);
  }
});

test("the model has exactly the fields the renderer draws, whatever the input", () => {
  const keys = ["branch", "busy", "checkedAt", "counts", "details", "glyph", "id", "label", "primary", "repo", "secondary", "sentence", "short", "tone"];
  for (const [name, input] of CASES) {
    const model = git.describe(input);
    assert.deepEqual(Object.keys(model).sort(), keys, name);
    assert.deepEqual(Object.keys(model.counts).sort(), ["ahead", "behind", "dirty"], name);
    assert.ok(Array.isArray(model.details) && model.details.every((line) => typeof line === "string" && line), name);
    assert.equal(typeof model.sentence, "string", name);
    assert.ok(model.label.length > 0 && !/[{}]/.test(`${model.label}${model.sentence}${model.primary?.label ?? ""}${model.secondary?.label ?? ""}`), `${name}: a blank was left unfilled`);
    for (const action of [model.primary, model.secondary]) {
      if (!action) continue;
      assert.ok(git.ACTION_IDS.includes(action.id), `${name}: ${action.id}`);
      assert.equal(typeof action.confirm, "boolean", name);
    }
  }
});

test("describe survives any input and never changes what it was given", () => {
  for (const input of [undefined, null, 0, "x", [], {}, { glance: "no" }, { sync: 5 }, { glance: { isRepo: "yes" } }, { glance: null, sync: { problems: "oops" } }, { busy: {} }, { project: 3 }]) {
    assert.equal(git.describe(input).id, "unknown", JSON.stringify(input));
  }
  const frozen = (value) => { Object.freeze(value); for (const item of Object.values(value)) if (item && typeof item === "object") frozen(item); return value; };
  const input = frozen({ glance: glance({ ahead: 2, dirty: 3 }), sync: syncOf([problem("offline", { detail: "x" })], { pending: [{ kind: "stash", text: "1 stash saved on this PC." }] }), account: "me", checkedAt: 7, project: { weakDrive: false } });
  const before = JSON.stringify(input);
  git.describe(input);
  assert.equal(JSON.stringify(input), before);
});

test("counts read singular and plural the way the brief shows them", () => {
  const one = git.describe({ glance: glance({ ahead: 1 }) });
  assert.equal(one.label, "1 to push");
  assert.equal(one.primary.label, "Push 1 commit");
  assert.deepEqual(one.details, ["1 commit on main not pushed yet."]);
  const two = git.describe({ glance: glance({ ahead: 2 }) });
  assert.equal(two.label, "2 to push");
  assert.equal(two.primary.label, "Push 2 commits");
  assert.equal(two.short, "2");
  assert.equal(git.describe({ glance: glance({ ahead: 12 }) }).label, "12 to push");

  const pull = git.describe({ glance: glance({ behind: 1 }) });
  assert.equal(pull.label, "1 to pull");
  assert.equal(pull.sentence, "GitHub has 1 commit this PC has not pulled yet.");
  assert.equal(pull.primary.label, "Pull 1 commit");
  assert.equal(git.describe({ glance: glance({ behind: 3 }) }).sentence, "GitHub has 3 commits this PC has not pulled yet.");

  const file = git.describe({ glance: glance({ dirty: 1 }) });
  assert.equal(file.label, "1 change");
  assert.equal(file.sentence, "1 uncommitted file in this checkout.");
  assert.equal(file.primary.label, "Save and push 1 file");
  const files = git.describe({ glance: glance({ dirty: 4 }) });
  assert.equal(files.label, "4 changes");
  assert.equal(files.sentence, "4 uncommitted files in this checkout.");
  assert.equal(files.primary.label, "Save and push 4 files");
  assert.equal(files.short, "4");
  assert.equal(git.describe({ glance: glance() }).short, "", "a chip too narrow for words shows no number when there is none");
});

test("the primary morphs with the state and pull and push never compete", () => {
  const primary = (input) => git.describe(input).primary;
  assert.deepEqual(primary({ glance: glance({ ahead: 2 }) }), { id: "push", label: "Push 2 commits", confirm: true });
  assert.deepEqual(primary({ glance: glance({ behind: 3 }) }), { id: "pull", label: "Pull 3 commits", confirm: false });
  assert.deepEqual(primary({ glance: glance() }), { id: "check", label: "Check GitHub", confirm: false });
  assert.deepEqual(primary({ glance: glance({ remote: null, upstream: null }) }), { id: "publish", label: "Publish to GitHub", confirm: false });
  assert.deepEqual(primary({ glance: glance({ upstream: null }) }), { id: "push", label: "Push main to GitHub", confirm: true });
  assert.deepEqual(primary({ glance: glance(), account: null }), { id: "sign-in", label: "Sign in to GitHub", confirm: false });
  assert.deepEqual(primary({ glance: glance({ ahead: 1, behind: 1 }) }), { id: "rebase", label: "Put my commits on top of GitHub's", confirm: true });
  assert.deepEqual(primary({ glance: glance({ behind: 2 }), agentsBuilding: true }), { id: "pull-anyway", label: "Pull now", confirm: false });
  assert.equal(primary({ glance: glance({ remote: "other" }) }), null);
  assert.equal(primary({ glance: glance({ behind: 3 }), busy: "pulling" }), null, "a working state offers nothing to press");
  assert.equal(git.describe({ glance: glance(), busy: "pushing" }).secondary.id, "details");
  const secondaries = ["ahead", "behind"].map((key) => git.describe({ glance: glance({ [key]: 2 }) }).secondary.id);
  assert.deepEqual(secondaries, ["show-push", "show-changes"]);
});

test("push never commits silently: with files to save the primary is the Save-and-push dialog", () => {
  const ahead = git.describe({ glance: glance({ ahead: 2, dirty: 4 }) });
  assert.equal(ahead.id, "ahead");
  assert.equal(ahead.label, "2 to push");
  assert.deepEqual(ahead.primary, { id: "save-and-push", label: "Save and push 4 files", confirm: false });
  assert.deepEqual(ahead.secondary, { id: "push", label: "Push 2 commits only", confirm: true });
  assert.ok(ahead.details.includes("4 uncommitted files in this checkout."));

  const first = git.describe({ glance: glance({ upstream: null, dirty: 1 }) });
  assert.deepEqual(first.primary, { id: "save-and-push", label: "Save and push 1 file", confirm: false });
  assert.equal(first.secondary.id, "push");

  const branch = git.describe({ glance: glance({ branch: "wip/x", onDefault: false, upstream: "origin/wip/x", ahead: 1, dirty: 2 }) });
  assert.equal(branch.primary.id, "save-and-push");

  const clean = git.describe({ glance: glance({ ahead: 2 }) });
  assert.equal(clean.primary.id, "push");
  const only = git.describe({ glance: glance({ dirty: 3 }) });
  assert.equal(only.primary.id, "save-and-push");
  assert.equal(only.secondary.id, "save");
  assert.deepEqual(git.describe({ glance: glance({ behind: 2, dirty: 3 }) }).primary.id, "pull", "a fast-forward never touches uncommitted work, so Pull stays");
});

test("diverged is a decision card: rebase only when clean, otherwise save first", () => {
  const clean = git.describe({ glance: glance({ ahead: 2, behind: 3 }) });
  assert.equal(clean.sentence, "main changed on this PC and on GitHub. Put this PC's commits on top of GitHub's, then sync.");
  assert.equal(clean.primary.id, "rebase");
  assert.equal(clean.secondary.id, "ask-mefi-combine");
  assert.deepEqual(clean.details.slice(0, 2), ["2 commits on this PC not on GitHub.", "3 commits on GitHub not on this PC."]);
  const dirty = git.describe({ glance: glance({ ahead: 2, behind: 3, dirty: 1 }) });
  assert.equal(dirty.sentence, "main changed on this PC and on GitHub. Commit or set aside the uncommitted files, then put this PC's commits on top of GitHub's.");
  assert.equal(dirty.primary.id, "save");
  assert.equal(dirty.primary.label, "Save my changes");
});

test("branches: master, another branch, detached and an unborn repo say what they are", () => {
  const master = git.describe({ glance: glance({ branch: "master", onDefault: true, upstream: "origin/master" }) });
  assert.equal(master.id, "in-sync");
  assert.equal(master.sentence, "This PC matches GitHub master.");
  assert.equal(master.branch, "master");

  const wrong = git.describe({ glance: glance({ branch: "master", onDefault: false, main: "main" }) });
  assert.equal(wrong.label, "On master");
  assert.equal(wrong.sentence, "This checkout is on branch master, not main.");

  const wip = git.describe({ glance: glance({ branch: "wip/site-rebuild", onDefault: false, upstream: "origin/wip/site-rebuild", ahead: 2 }) });
  assert.equal(wip.label, "On wip/site-rebuild");
  assert.equal(wip.tone, "warn");
  assert.deepEqual(wip.primary, { id: "push", label: "Push this branch", confirm: true });
  assert.deepEqual(wip.details, ["2 commits on wip/site-rebuild not pushed yet."]);
  const level = git.describe({ glance: glance({ branch: "wip/x", onDefault: false, upstream: "origin/wip/x" }) });
  assert.equal(level.primary.disabled, true);
  assert.match(level.primary.why, /Nothing on this branch/);
  const fresh = git.describe({ glance: glance({ branch: "wip/y", onDefault: false, upstream: null }) });
  assert.equal(fresh.primary.disabled, undefined);
  assert.ok(fresh.details.includes("This branch is not on GitHub yet."));

  const detached = git.describe({ glance: glance({ branch: "HEAD", detached: true, onDefault: false }) });
  assert.equal(detached.label, "Not on a branch");
  assert.equal(detached.sentence, "This checkout is on a detached HEAD, not main.");
  assert.equal(detached.branch, null);
  assert.equal(detached.primary.id, "start-branch");

  const unborn = git.describe({ glance: glance({ unborn: true, branch: "master", upstream: null, remote: null }) });
  assert.equal(unborn.id, "no-commits");
  assert.equal(unborn.branch, "master");
  assert.equal(unborn.sentence, "No commits yet. Save a first commit, then publish.");
  assert.equal(unborn.primary.id, "save-first");
});

test("signed out is offered only when the project needs GitHub", () => {
  assert.equal(git.describe({ glance: glance(), account: null }).sentence, "Sign in to GitHub first.");
  assert.equal(git.describe({ glance: glance({ remote: null, upstream: null }), account: null }).id, "no-remote");
  // pc-setup's answer shape: an account name, or null with the tools it found.
  assert.equal(git.describe({ glance: glance(), account: { ok: true, account: null, ghInstalled: true, gitInstalled: true } }).id, "signed-out");
  assert.equal(git.describe({ glance: glance(), account: { ok: true, account: "me", ghInstalled: true, gitInstalled: true } }).id, "in-sync");
  const missing = git.describe({ glance: glance(), account: { ok: true, account: null, ghInstalled: false } });
  assert.equal(missing.id, "signed-out");
  assert.equal(missing.primary.id, "install-gh");
  assert.equal(missing.sentence, "GitHub CLI is not installed on this PC.");
  assert.equal(git.describe({ glance: glance(), account: "" }).id, "signed-out", "an empty name is nobody");
});

test("a drive Git cannot use keeps Publish from being offered", () => {
  const model = git.describe({ glance: glance({ remote: null, upstream: null }), project: { weakDrive: true } });
  assert.equal(model.id, "no-remote");
  assert.equal(model.primary.id, "publish");
  assert.equal(model.primary.disabled, true);
  assert.match(model.primary.why, /NTFS/);
  assert.equal(git.describe({ glance: glance({ remote: null, upstream: null }), project: { weakDrive: false } }).primary.disabled, undefined);
});

test("problems read the way scripts/sync.mjs words them", () => {
  const fetchFailed = git.describe({ glance: glance(), sync: syncOf([problem("fetch-failed", { detail: "fatal: Authentication failed" })]) });
  assert.equal(fetchFailed.sentence, "Couldn't check GitHub (fatal: Authentication failed). Sign in to GitHub again or check this project's GitHub address; nothing was changed.");
  assert.equal(fetchFailed.primary.id, "sign-in");
  assert.equal(fetchFailed.secondary.id, "retry");

  const offline = git.describe({ glance: glance({ ahead: 1 }), sync: syncOf([problem("offline", { detail: "Could not resolve host: github.com" })], { pending: [{ kind: "unpushed", text: "1 commit on main not pushed yet." }] }) });
  assert.equal(offline.sentence, "GitHub could not be reached. Some work on this PC is not on GitHub yet.");
  assert.ok(offline.details.includes("Could not reach GitHub: Could not resolve host: github.com"));
  assert.equal(offline.secondary, null, "nothing to save on this PC");
  const quiet = git.describe({ glance: glance(), sync: syncOf([problem("offline", { detail: "x" })]) });
  assert.equal(quiet.sentence, "GitHub could not be reached. As of the last check, this PC matched GitHub.");
  const saving = git.describe({ glance: glance({ dirty: 2 }), sync: syncOf([problem("offline", { detail: "x" })]) });
  assert.equal(saving.secondary.id, "save");

  const checkFailed = git.describe({ glance: glance({ ahead: 1 }), sync: syncOf([problem("check-failed", { detail: "tests/x.test.mjs: nope" })]) });
  assert.equal(checkFailed.sentence, "The project's check failed, so nothing was pushed. Fix it, then sync again.");
  assert.deepEqual(checkFailed.details, ["npm run check: tests/x.test.mjs: nope", "1 commit on main not pushed yet."].slice(0, 1));

  const finding = { merge: "3f9c2ab1234", subject: "Merge wip/site-rebuild", lines: 214, count: 5, files: [{ path: "scripts/sync.mjs" }, { path: "renderer/pc-sync.js" }, { path: "a.js" }] };
  const lost = git.describe({ glance: glance({ ahead: 1 }), sync: syncOf([problem("lost-work", { findings: [finding, { ...finding, merge: "abcdef01", lines: 1, count: 1, files: [{ path: "b.js" }] }] })]) });
  assert.equal(lost.sentence, "Nothing was pushed. Merge 3f9c2ab (Merge wip/site-rebuild) left out 214 lines of 5 files another branch changed (scripts/sync.mjs, renderer/pc-sync.js, a.js and 2 more). Restore them, or if that was deliberate say so with a \"Lost-work-ok: <why>\" line in a commit message.");
  assert.equal(lost.details[0], "Merge abcdef0 (Merge wip/site-rebuild) left out 1 line of 1 file another branch changed (b.js). Restore them, or if that was deliberate say so with a \"Lost-work-ok: <why>\" line in a commit message.");

  const conflict = git.describe({ glance: glance({ ahead: 1, behind: 1 }), sync: syncOf([problem("rebase-conflict", { files: ["a.js", "b.js", "c.js", "d.js"] })]) });
  assert.equal(conflict.sentence, "Your commits and GitHub's both change a.js, b.js, c.js. Nothing was changed; merge them by hand or ask Mefi.");
  const blind = git.describe({ glance: glance({ ahead: 1, behind: 1 }), sync: syncOf([problem("rebase-conflict", { files: [] })]) });
  assert.match(blind.sentence, /both change the same lines\./);

  const pull = git.describe({ glance: glance({ behind: 1 }), sync: syncOf([problem("pull-refused", { detail: "error: Your local changes would be overwritten by merge:" })]) });
  assert.equal(pull.sentence, "Could not fast-forward main (uncommitted edits in the way?): error: Your local changes would be overwritten by merge:");
  assert.equal(pull.primary.id, "pull", "nothing uncommitted: try the pull again");
  const blocked = git.describe({ glance: glance({ behind: 1, dirty: 2 }), sync: syncOf([problem("pull-refused", { detail: "x" })]) });
  assert.equal(blocked.primary.id, "save");

  const error = git.describe({ sync: { ok: false, headline: "Sync could not run: spawn git ENOENT", problems: [{ kind: "error" }] } });
  assert.equal(error.sentence, "Sync could not run: spawn git ENOENT");
  assert.equal(error.label, "Sync did not run");
});

test("a refused push says why in one sentence and offers the fix", () => {
  const cases = [
    ["! [rejected] main -> main (fetch first)\nhint: See the 'Note about fast-forwards' in 'git push --help' for details.", "GitHub has newer work. Pull first.", "pull", "Pull, then push"],
    ["remote: Permission to o/n.git denied to me.\nfatal: unable to access 'https://github.com/o/n.git/': The requested URL returned error: 403", "GitHub did not accept this PC's sign-in.", "sign-in", "Sign in again"],
    [" ! [remote rejected] main -> main (refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope)", "Your GitHub sign-in cannot push workflow files.", "add-permission", "Add permission"],
    ["remote: error: GH006: Protected branch update failed for refs/heads/main.", "GitHub does not allow direct pushes to main.", "push-branch", "Push a branch"],
  ];
  for (const [stderr, sentence, id, label] of cases) {
    const model = git.describe({ glance: glance({ ahead: 1 }), sync: syncOf([problem("push-refused", { detail: "hint: last line", stderr })]) });
    assert.equal(model.id, "push-refused", sentence);
    assert.equal(model.sentence, sentence);
    assert.equal(model.primary.id, id);
    assert.equal(model.primary.label, label);
    assert.equal(model.secondary.id, "details");
  }
  // One nobody named keeps sync.mjs's own words and its last line.
  const odd = git.describe({ glance: glance({ ahead: 1 }), sync: syncOf([problem("push-refused", { detail: "the remote hung up unexpectedly" })]) });
  assert.equal(odd.sentence, "GitHub refused the push: the remote hung up unexpectedly");
  assert.equal(odd.primary.id, "retry");
  // Only the last stderr line of a plain rejection is a hint line: the classification still finds it.
  const hint = git.describe({ glance: glance({ ahead: 1 }), sync: syncOf([problem("push-refused", { detail: "hint: See the 'Note about fast-forwards' in 'git push --help' for details." })]) });
  assert.equal(hint.sentence, "GitHub has newer work. Pull first.");
  assert.deepEqual(hint.details, ["1 commit on main not pushed yet."].slice(0, 0));
  // A first push that fails on a repository GitHub cannot find is a failed check, not a refusal.
  const gone = git.describe({ glance: glance({ upstream: null }), refusal: git.classifyPush("remote: Repository not found.\nfatal: repository 'https://github.com/o/n.git/' not found") });
  assert.equal(gone.id, "fetch-failed");
  assert.equal(gone.primary.id, "sign-in");
});

test("the stages of working states are announced as detail lines, no percentages", () => {
  const pushing = git.describe({ glance: glance({ ahead: 2 }), busy: "pushing" });
  assert.equal(pushing.busy, "pushing");
  assert.equal(pushing.sentence, "Checking nothing was left out. Running the project's check. Uploading 2 commits.");
  assert.deepEqual(pushing.details, ["Checking nothing was left out", "Running the project's check", "Uploading 2 commits"]);
  assert.equal(git.describe({ glance: glance(), busy: "pushing" }).details[2], "Uploading your commits");
  const publishing = git.describe({ glance: glance({ remote: null, upstream: null }), busy: "publishing", project: { repo: "nateecho32-stack/field-notes" } });
  assert.equal(publishing.sentence, "Saving a first commit. Creating nateecho32-stack/field-notes. Uploading.");
  assert.equal(publishing.repo, "nateecho32-stack/field-notes");
  assert.equal(git.describe({ glance: glance({ dirty: 4 }), busy: "saving" }).sentence, "Saving 4 files on this PC.");
  assert.equal(git.describe({ glance: glance({ dirty: 1 }), busy: "saving" }).sentence, "Saving 1 file on this PC.");
  assert.equal(git.describe({ glance: glance({ behind: 3 }), busy: "pulling" }).sentence, `Getting 3 commits from GitHub${ELLIPSIS}`);
  assert.equal(git.describe({ glance: glance(), busy: "checking" }).sentence, "Looking at GitHub. Nothing is being changed.");
  for (const busy of ["saving", "pushing", "pulling", "publishing", "checking"]) {
    const model = git.describe({ glance: glance({ ahead: 1 }), busy });
    assert.equal(model.busy, busy);
    assert.equal(model.primary, null);
  }
  assert.equal(git.describe({ glance: glance() }).busy, null);
});

test("what just finished is said once, in the words sync.mjs uses", () => {
  const cases = [
    [{ kind: "pushed", commits: 2 }, "Pushed 2 commits to GitHub."],
    [{ kind: "pushed", commits: 1 }, "Pushed 1 commit to GitHub."],
    [{ kind: "pulled", commits: 3 }, "Pulled 3 commits from GitHub."],
    [{ kind: "rebased", commits: 2 }, "Put 2 commits from this PC on top of GitHub's."],
    [{ kind: "published", repo: "nateecho32-stack/field-notes", visibility: "private" }, "Published nateecho32-stack/field-notes."],
    [{ kind: "saved", files: 4 }, "Saved 4 files on this PC."],
  ];
  for (const [outcome, sentence] of cases) {
    const model = git.describe({ glance: glance(), outcome });
    assert.equal(model.id, "success");
    assert.equal(model.sentence, sentence);
    assert.equal(model.label, "Done");
    assert.equal(model.tone, "good");
  }
  const published = git.describe({ glance: glance(), outcome: { kind: "published", repo: "o/n", visibility: "private" } });
  assert.deepEqual(published.details, ["Private. Only you can see it."]);
  assert.deepEqual(git.describe({ glance: glance(), outcome: { kind: "published", repo: "o/n", visibility: "public" } }).details, ["Public. Anyone on GitHub can see it."]);
  assert.equal(git.describe({ glance: glance(), outcome: { kind: "pushed", commits: 1 } }).primary.id, "open-github");
  assert.equal(git.describe({ glance: glance({ remote: null, upstream: null }), outcome: { kind: "saved", files: 2 } }).primary, null);
  assert.equal(git.describe({ glance: glance({ dirty: 0, ahead: 1 }), outcome: { kind: "saved", files: 2 } }).primary, null, "a save has nothing to open on GitHub yet");
});

test("detail lines carry what the sentence leaves out, and cope with a long list", () => {
  const pending = [
    { kind: "branch", text: "This checkout is on branch wip/x, not main." },
    { kind: "uncommitted", text: "3 uncommitted files in this checkout." },
    { kind: "unpushed", text: "2 commits on main not pushed yet." },
    { kind: "stash", text: "2 stashes saved on this PC." },
    { kind: "worktree", text: "Worktree a (wip/a): 1 uncommitted file." },
    { kind: "local-branch", text: "Branch wip/b on this PC: 4 commits not on main." },
    { kind: "github-branch", text: "Branch wip/c on GitHub: 1 commit not on main." },
    { kind: "lost-work", text: "Merge 3f9c2ab (x) left out 3 lines of 1 file another branch changed (a). Restore them, or if that was deliberate say so with a \"Lost-work-ok: <why>\" line in a commit message." },
  ];
  const model = git.describe({ glance: glance({ ahead: 2, dirty: 3 }), sync: syncOf([], { pending }) });
  assert.deepEqual(model.details, [
    "2 commits on main not pushed yet.",
    "3 uncommitted files in this checkout.",
    "2 stashes saved on this PC.",
    "Worktree a (wip/a): 1 uncommitted file.",
    "Branch wip/b on this PC: 4 commits not on main.",
    "Branch wip/c on GitHub: 1 commit not on main.",
    pending[7].text,
  ]);
  const many = Array.from({ length: 30 }, (_, index) => ({ kind: "worktree", text: `Worktree w${index} (wip/${index}): 1 uncommitted file.` }));
  const long = git.describe({ glance: glance(), sync: syncOf([], { pending: many }) });
  assert.equal(long.details.length, 12);
  assert.equal(long.details.at(-1), "and 19 more.", "eleven lines shown, nineteen left");
  assert.deepEqual(git.describe({ glance: glance() }).details, []);
});

test("the model carries the account's repository, the branch, the counts and when GitHub was last looked at", () => {
  const model = git.describe({ glance: glance({ ahead: 2, behind: 0, dirty: 1 }), checkedAt: 1_700_000_000_000, sync: syncOf([], { checkedAt: 1_600_000_000_000 }) });
  assert.equal(model.repo, "nateecho32-stack/mefi-studio");
  assert.equal(model.branch, "main");
  assert.deepEqual(model.counts, { ahead: 2, behind: 0, dirty: 1 });
  assert.equal(model.checkedAt, 1_700_000_000_000, "the caller's time wins");
  assert.equal(git.describe({ glance: glance(), sync: syncOf([], { checkedAt: 1_600_000_000_000 }) }).checkedAt, 1_600_000_000_000);
  assert.equal(git.describe({ glance: glance() }).checkedAt, null);
  assert.equal(git.describe({ glance: glance({ remote: null, upstream: null }) }).repo, null);
  assert.equal(git.describe({ glance: glance({ remote: "other" }) }).repo, null);
  assert.deepEqual(git.describe({ glance: glance({ ahead: -3, behind: "x", dirty: 2.9 }) }).counts, { ahead: 0, behind: 0, dirty: 2 });
});

test("a launch row keeps the chip and drops what was never read", () => {
  assert.equal(git.chip(git.describe({})), null);
  assert.equal(git.chip(null), null);
  const chip = git.chip(git.describe({ glance: glance({ ahead: 2 }) }));
  assert.deepEqual(chip, { id: "ahead", label: "2 to push", tone: "info", glyph: "ahead", sentence: "Some work on this PC is not on GitHub yet." });
});

// ---- repository names -------------------------------------------------------------
test("a folder name becomes a GitHub name", () => {
  const cases = [
    ["Mefi's Studio AI+", "Mefis-Studio-AI"],
    ["Mefi\u2019s Studio", "Mefis-Studio"],
    ["field-notes", "field-notes"],
    ["Field Notes", "Field-Notes"],
    ["  spaces   here  ", "spaces-here"],
    ["a+b", "a-b"],
    ["C++ Notes", "C-Notes"],
    ["Caf\u00e9 D\u00e9j\u00e0 Vu", "Cafe-Deja-Vu"],
    ["a/b\\c", "a-b-c"],
    ["--a--", "a"],
    [".hidden", "hidden"],
    ["repo.git", "repo"],
    ["repo.GIT", "repo"],
    ["x.git.git", "x"],
    ["v1.2_final", "v1.2_final"],
    ["a...b", "a...b"],
    ["\u65e5\u672c\u8a9e", ""],
    ["..", ""],
    [".", ""],
    [".git", ""],
    ["", ""],
    [null, ""],
    [undefined, ""],
    [42, "42"],
  ];
  for (const [folder, name] of cases) assert.equal(git.repoName(folder), name, JSON.stringify(folder));
  const long = git.repoName("a".repeat(150));
  assert.equal(long.length, 100);
  assert.equal(git.repoName(`${"a".repeat(99)}-b`), "a".repeat(99), "a cut that ends on a hyphen is trimmed");
  assert.equal(git.repoName(`${"a".repeat(95)}.gitx`), `${"a".repeat(95)}.gitx`, "exactly 100 is kept");
  assert.equal(git.repoName(`${"a".repeat(96)}.gitx`), "a".repeat(96), "a cut that leaves .git at the end drops it");
  assert.equal(git.repoName(`${"a".repeat(97)}.git.git`), "a".repeat(97));
});

test("every name repoName makes is one validRepo accepts", () => {
  for (const folder of ["Mefi's Studio AI+", "Pixel Garden!", "a".repeat(300), "x.git", "..a..", "Caf\u00e9", "1", "-", "A B  C", "\u00fcber_app", "name (copy)", "a\tb\nc"]) {
    const name = git.repoName(folder);
    if (name) assert.equal(git.validRepo("nateecho32-stack", name), true, `${JSON.stringify(folder)} -> ${name}`);
  }
});

test("validRepo reuses the pc-setup shape and adds the names GitHub refuses", () => {
  const ok = [["nateecho32-stack", "mefi-studio"], ["a", "b"], ["o", "a.b_c-d"], ["o", ".github"], ["o", "a".repeat(100)], ["a".repeat(39), "x"], ["O-1", "X.y"]];
  for (const [owner, name] of ok) assert.equal(git.validRepo(owner, name), true, `${owner}/${name}`);
  const bad = [
    ["o", "."], ["o", ".."], ["o", "x.git"], ["o", "X.GIT"], ["o", "a b"], ["o", "a+b"], ["o", "Mefi's"], ["o", "\u00e9"], ["o", "a".repeat(101)],
    ["", "x"], ["o", ""], ["a".repeat(40), "x"], ["o/x", "y"], ["o", "x/y"], ["o_x", "y"], ["o", "x\ny"], [null, "x"], ["o", null], [undefined, undefined], [1, 2],
  ];
  for (const [owner, name] of bad) assert.equal(git.validRepo(owner, name), false, `${owner}/${name}`);
  // The app's own validator (pc-setup.cjs REPO) agrees on the shapes both accept.
  const REPO = /^[A-Za-z0-9-]{1,39}\/[A-Za-z0-9._-]{1,100}$/;
  for (const [owner, name] of [...ok, ...bad]) if (git.validRepo(owner, name)) assert.ok(REPO.test(`${owner}/${name}`));
});

test("a name that does not work says why", () => {
  assert.equal(git.repoIssue("me", "field-notes"), null);
  assert.equal(git.repoIssue("me", ""), "Give the project a GitHub name.");
  assert.equal(git.repoIssue("me", "a".repeat(101)), "A GitHub name can be up to 100 characters.");
  assert.equal(git.repoIssue("me", ".."), "GitHub does not accept \".\" or \"..\" as a name.");
  assert.equal(git.repoIssue("me", "notes.git"), "A GitHub name cannot end with .git.");
  assert.equal(git.repoIssue("me", "a b"), "Use letters, numbers, dots, dashes and underscores.");
  assert.equal(git.repoIssue("", "x"), "That GitHub account name is not valid.");
});

test("a taken name gets other names to try, never one that is taken", () => {
  assert.deepEqual(git.nameSuggestions("field-notes"), ["field-notes-2", "field-notes-3", "field-notes-app"]);
  assert.deepEqual(git.nameSuggestions("Field Notes", ["Field-Notes-2", "field-notes-3"]), ["Field-Notes-app", "Field-Notes-4"]);
  assert.deepEqual(git.nameSuggestions("\u65e5\u672c\u8a9e"), []);
  assert.deepEqual(git.nameSuggestions(""), []);
  const long = git.nameSuggestions("a".repeat(100));
  assert.equal(long.length, 3);
  for (const name of long) assert.equal(git.validRepo("me", name), true, name);
  assert.ok(long.every((name) => name.length <= 100));
  assert.deepEqual(git.nameSuggestions("x", new Set(["x-2"])), ["x-3", "x-app", "x-4"]);
});

// ---- .gitignore and licenses -------------------------------------------------------
test("the starting .gitignore keeps secrets, dependencies and build output out, and adds the stacks it is told about", () => {
  const plain = git.gitignoreFor();
  const lines = plain.split("\n");
  for (const rule of ["node_modules/", "dist/", ".env", ".env.*", "!.env.example", "auth.json", "credentials.json", "secrets/", "*.pem", "*.key", "*.log", "*.db"]) {
    assert.ok(lines.includes(rule), rule);
  }
  assert.ok(plain.endsWith("\n") && !plain.endsWith("\n\n"));
  assert.match(plain, /^# Written by Mefi's Studio AI\+/);
  assert.equal(plain, git.gitignoreFor([]));
  assert.equal(plain, git.gitignoreFor(["cobol", null, 3]), "an unknown stack adds nothing");
  const stacked = git.gitignoreFor(["Node", "python", "love", "node"]);
  assert.ok(stacked.includes("\n# Node.js\ncoverage/\n"));
  assert.ok(stacked.includes("\n# Python\n__pycache__/\n"));
  assert.ok(stacked.includes("\n# LOVE\n*.love\n"));
  assert.equal(stacked.split("# Node.js").length, 2, "each stack once");
  assert.equal(git.gitignoreFor("node"), plain, "a string is not a list of stacks");
  // Every rule the baseline names for a blocked path really does block it.
  for (const rule of ["auth.json", "credentials.json", ".env", "x.pem", "x.key"]) assert.equal(git.pathBlocked(rule)?.kind, "secret", rule);
});

test("license text carries the year and holder", () => {
  const mit = git.licenseText("mit", { holder: "Mefi", year: 2026 });
  assert.match(mit, /^MIT License\n\nCopyright \(c\) 2026 Mefi\n\nPermission is hereby granted, free of charge/);
  assert.ok(mit.endsWith("SOFTWARE.\n"));
  assert.doesNotMatch(mit, /[{}]/);
  const apache = git.licenseText("apache-2.0", { holder: "Mefi", year: 2026 });
  assert.match(apache, /^ +Apache License\n +Version 2\.0, January 2004\n/);
  assert.ok(apache.includes("\n   Copyright 2026 Mefi\n\n   Licensed under the Apache License, Version 2.0 (the \"License\");"));
  assert.ok(apache.endsWith("limitations under the License.\n"));
  assert.doesNotMatch(apache, /\{notice\}|\[yyyy\]|\[name of copyright owner\]/);
  assert.ok(apache.length > 11000 && apache.length < 11500, `the Apache-2.0 text is the standard one (${apache.length} characters)`);
  assert.equal(apache.split("\n").filter((line) => /^\s*\d+\. [A-Z]/.test(line)).length, 9, "sections 1 to 9");

  assert.equal(git.licenseText("none"), "");
  assert.equal(git.licenseText("gpl-3.0"), null);
  assert.equal(git.licenseText(undefined), null);
  assert.equal(git.licenseText("MIT", { holder: "A", year: 2001 }).includes("Copyright (c) 2001 A\n"), true, "ids are case-blind");
  assert.match(git.licenseText("mit", { year: 2026 }), /Copyright \(c\) 2026\n/);
  assert.match(git.licenseText("mit"), /Copyright \(c\) the authors\n/);
  assert.match(git.licenseText("mit", { holder: "  Ada \n\t Lovelace  ", year: 1843 }), /Copyright \(c\) 1843 Ada Lovelace\n/);
  assert.match(git.licenseText("mit", { holder: "$& $1 {notice}", year: 2026 }), /Copyright \(c\) 2026 \$& \$1 \{notice\}\n/, "a holder is text, never a pattern");
  assert.match(git.licenseText("mit", { holder: "Mefi", year: "2026" }), /Copyright \(c\) Mefi\n/, "the year comes as a number from the caller");
});

// ---- what a failure means -------------------------------------------------------------
test("a rejected push is 'GitHub has newer work. Pull first.'", () => {
  const fetchFirst = [
    "To https://github.com/nateecho32-stack/mefi-studio.git",
    " ! [rejected]        main -> main (fetch first)",
    "error: failed to push some refs to 'https://github.com/nateecho32-stack/mefi-studio.git'",
    "hint: Updates were rejected because the remote contains work that you do not",
    "hint: have locally. This is usually caused by another repository pushing to",
    "hint: the same ref. If you want to integrate the remote changes, use",
    "hint: 'git pull' before pushing again.",
    "hint: See the 'Note about fast-forwards' in 'git push --help' for details.",
  ].join("\n");
  const result = git.classifyPush(fetchFirst);
  assert.deepEqual({ kind: result.kind, text: result.text, fix: result.fix, state: result.state }, { kind: "non-fast-forward", text: "GitHub has newer work. Pull first.", fix: "pull", state: "push-refused" });
  assert.equal(result.detail, "failed to push some refs to 'https://github.com/nateecho32-stack/mefi-studio.git'", "the closing hint lines are not the detail");
  assert.equal(git.classifyPush(" ! [rejected]        main -> main (non-fast-forward)\nerror: failed to push some refs").kind, "non-fast-forward");
  assert.equal(git.classifyPush("hint: See the 'Note about fast-forwards' in 'git push --help' for details.").kind, "non-fast-forward", "sync.mjs keeps only this last line");
  assert.equal(git.classifyPush("hint: tip of your current branch is behind its remote counterpart").kind, "non-fast-forward");
});

test("a push GitHub's rules stop says what to do next", () => {
  const protectedBranch = "remote: error: GH006: Protected branch update failed for refs/heads/main.\nremote: error: Changes must be made through a pull request.\nTo https://github.com/o/n.git\n ! [remote rejected] main -> main (protected branch hook declined)\nerror: failed to push some refs to 'https://github.com/o/n.git'";
  const protectedResult = git.classifyPush(protectedBranch);
  assert.equal(protectedResult.kind, "protected-branch");
  assert.equal(protectedResult.text, "GitHub does not allow direct pushes to main.");
  assert.equal(protectedResult.fix, "push-branch");
  assert.equal(git.classifyPush(protectedBranch, { branch: "release" }).text, "GitHub does not allow direct pushes to release.");
  const ruleset = git.classifyPush("remote: error: GH013: Repository rule violations found for refs/heads/develop.\nremote: - Changes must be made through a pull request.");
  assert.equal(ruleset.kind, "protected-branch");
  assert.equal(ruleset.text, "GitHub does not allow direct pushes to develop.");
  assert.equal(git.classifyPush(" ! [remote rejected] main -> main (protected branch hook declined)").text, "GitHub does not allow direct pushes to main.");
  assert.equal(git.classifyPush("remote: error: GH006: Protected branch update failed.").text, "GitHub does not allow direct pushes to this branch.");

  const workflow = git.classifyPush(" ! [remote rejected] main -> main (refusing to allow an OAuth App to create or update workflow `.github/workflows/ci.yml` without `workflow` scope)");
  assert.deepEqual({ kind: workflow.kind, text: workflow.text, fix: workflow.fix }, { kind: "workflow-scope", text: "Your GitHub sign-in cannot push workflow files.", fix: "add-permission" });
  assert.equal(git.classifyPush("! [remote rejected] main -> main (refusing to allow a Personal Access Token to create or update workflow `.github/workflows/x.yml` without `workflow` scope)").kind, "workflow-scope");
});

test("a push refused for who you are says the sign-in was not accepted", () => {
  for (const stderr of [
    "remote: Permission to nateecho32-stack/mefi-studio.git denied to someone-else.\nfatal: unable to access 'https://github.com/nateecho32-stack/mefi-studio.git/': The requested URL returned error: 403",
    "fatal: Authentication failed for 'https://github.com/nateecho32-stack/mefi-studio.git/'",
    "fatal: could not read Username for 'https://github.com': terminal prompts disabled",
    "remote: Invalid username or password.\nfatal: Authentication failed for 'https://github.com/o/n.git/'",
    "remote: Write access to repository not granted.\nfatal: unable to access 'https://github.com/o/n.git/': The requested URL returned error: 403",
    "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.",
  ]) {
    const result = git.classifyPush(stderr);
    assert.equal(result.kind, "auth", stderr);
    assert.equal(result.text, "GitHub did not accept this PC's sign-in.");
    assert.equal(result.fix, "sign-in");
  }
  const gone = git.classifyPush("remote: Repository not found.\nfatal: repository 'https://github.com/o/n.git/' not found");
  assert.equal(gone.kind, "not-found");
  assert.equal(gone.fix, "link");
  assert.equal(gone.state, "fetch-failed");
});

test("a push can be too big or carry a secret, and the file is named", () => {
  const big = git.classifyPush("remote: error: Trace: 1c1f\nremote: error: See https://gh.io/lfs for more information.\nremote: error: File installer.exe is 120.00 MB; this exceeds GitHub's file size limit of 100.00 MB\nremote: error: GH001: Large files detected. You may want to try Git Large File Storage - https://git-lfs.github.com.\nTo https://github.com/o/n.git");
  assert.equal(big.kind, "too-large");
  assert.equal(big.text, "installer.exe is 120 MB; GitHub refuses files over 100 MB.");
  assert.equal(big.fix, "leave-out-ignore");
  assert.equal(big.file, "installer.exe");
  assert.equal(big.mb, 120);
  assert.equal(big.state, "too-large");
  assert.equal(git.classifyPush("remote: File assets/intro reel.mp4 is 62.4 MiB; this exceeds GitHub's file size limit of 100.00 MB").text, "assets/intro reel.mp4 is 62 MB; GitHub refuses files over 100 MB.");
  assert.equal(git.classifyPush("remote: error: GH001: Large files detected.").text, "A file in this push is over GitHub's 100 MB limit.");

  const dashes = "\u2014".repeat(20);
  const secret = git.classifyPush([
    "remote: error: GH013: Repository rule violations found for refs/heads/main.",
    "remote: ",
    "remote: - GITHUB PUSH PROTECTION",
    `remote:   ${dashes}`,
    "remote:     Resolve the following violations before pushing again",
    "remote: ",
    "remote:     - Push cannot contain secrets",
    "remote: ",
    `remote:      \u2014\u2014 GitHub Personal Access Token ${dashes}`,
    "remote:       locations:",
    "remote:         - commit: 4a1c2b3d4e5f",
    "remote:           path: config/keys.txt:1",
  ].join("\n"));
  assert.equal(secret.kind, "secret");
  assert.equal(secret.text, "Stopped: a GitHub Personal Access Token in config/keys.txt.");
  assert.equal(secret.fix, "leave-out");
  assert.equal(secret.file, "config/keys.txt");
  assert.equal(secret.state, "blocked-secret");
  const aws = git.classifyPush(`remote: - GITHUB PUSH PROTECTION\nremote:   \u2014\u2014 Amazon AWS Access Key ID \u2014\u2014\u2014\u2014\nremote:           path: a/b.env:12\n`);
  assert.equal(aws.text, "Stopped: an Amazon AWS Access Key ID in a/b.env.");
  assert.equal(git.classifyPush("remote: Push cannot contain secrets").text, "Stopped: a secret in this push.");
});

test("offline, a long upload and something nobody named", () => {
  for (const stderr of [
    "fatal: unable to access 'https://github.com/o/n.git/': Could not resolve host: github.com",
    "fatal: unable to access 'https://github.com/o/n.git/': Failed to connect to github.com port 443 after 21050 ms: Couldn't connect to server",
    "fatal: unable to access 'https://github.com/o/n.git/': Connection timed out",
    "fatal: unable to access 'https://github.com/o/n.git/': OpenSSL SSL_read: Connection reset by peer, errno 10054 (ssl_error)",
  ]) {
    const result = git.classifyPush(stderr);
    assert.equal(result.kind, "offline", stderr);
    assert.equal(result.text, "GitHub could not be reached. Nothing was pushed.");
    assert.equal(result.state, "offline");
  }
  const slow = git.classifyPush("", { timedOut: true });
  assert.deepEqual({ kind: slow.kind, text: slow.text, fix: slow.fix, state: slow.state }, { kind: "timeout", text: "Still uploading.", fix: "wait", state: null });
  const odd = git.classifyPush("remote: something new\nfatal: the remote end hung up unexpectedly");
  assert.equal(odd.kind, "unknown");
  assert.equal(odd.text, "GitHub refused the push: the remote end hung up unexpectedly");
  assert.equal(odd.fix, "details");
  assert.equal(git.classifyPush("").text, "GitHub refused the push.");
  assert.equal(git.classifyPush(undefined).kind, "unknown");
});

test("git and gh output leaves this module with no login or token in it", () => {
  const dirty = "fatal: unable to access 'https://user:hunter2@github.com/o/n.git/': The requested URL returned error: 403\nremote: token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB and github_pat_11ABCDEFG0123456789_abcdefghijklmnopqrstuvwxyz";
  const result = git.classifyPush(dirty);
  assert.doesNotMatch(JSON.stringify(result), /hunter2|ghp_|github_pat_/);
  assert.equal(git.scrub("https://user:pw@github.com/o/n.git"), "https://github.com/o/n.git");
  assert.equal(git.scrub("ssh://git@github.com/o/n.git"), "ssh://github.com/o/n.git");
  assert.equal(git.scrub("gho_" + "a".repeat(30)), "[token]");
  assert.doesNotMatch(JSON.stringify(git.classifyGh("error: https://me:secret@github.com/x failed")), /secret/);
  const odd = git.classifyPush("fatal: something at https://u:p4ss@example.com/x broke");
  assert.doesNotMatch(odd.text, /p4ss/);
  // And nothing a sync or a caller hands describe can put one on the chip.
  const shown = git.describe({ glance: glance(), sync: syncOf([problem("fetch-failed", { detail: "unable to access 'https://user:hunter2@github.com/o/n.git/'" }), problem("offline", { detail: "https://a:b3@x.test/" })]) });
  assert.doesNotMatch(JSON.stringify(shown), /hunter2|b3@/);
  assert.match(shown.sentence, /unable to access 'https:\/\/github\.com\/o\/n\.git\/'/);
});

test("what gh says while making, listing or reading a repository", () => {
  const cases = [
    ["spawn gh ENOENT", "gh-missing", "GitHub CLI is not installed on this PC.", "install-gh"],
    ["'gh' is not recognized as an internal or external command,\noperable program or batch file.", "gh-missing", "GitHub CLI is not installed on this PC.", "install-gh"],
    ["bash: gh: command not found", "gh-missing", "GitHub CLI is not installed on this PC.", "install-gh"],
    ["spawn git ENOENT", "git-missing", "Git is not installed.", "install-git"],
    ["GraphQL: Name already exists on this account (createRepository)", "name-taken", "That name is already taken on GitHub. Link to it, or pick another name.", "link"],
    ["HTTP 422: Repository creation failed.: name already exists on this account (https://api.github.com/user/repos)", "name-taken", "That name is already taken on GitHub. Link to it, or pick another name.", "link"],
    ["You are not logged into any GitHub hosts. To log in, run: gh auth login", "not-signed-in", "Sign in to GitHub first.", "sign-in"],
    ["To get started with GitHub CLI, please run:  gh auth login\nAlternatively, populate the GH_TOKEN environment variable", "not-signed-in", "Sign in to GitHub first.", "sign-in"],
    ["HTTP 401: Bad credentials (https://api.github.com/graphql)", "not-signed-in", "Sign in to GitHub first.", "sign-in"],
    ["error connecting to api.github.com\ncheck your internet connection or https://githubstatus.com", "offline", "GitHub could not be reached.", "retry"],
    ["Post \"https://api.github.com/graphql\": dial tcp: lookup api.github.com: no such host", "offline", "GitHub could not be reached.", "retry"],
    ["GraphQL: nateecho32-stack cannot create a repository for void-engine. (createRepository)", "org-permission", "You can't create repositories in that organization. Pick your own account or another owner.", "pick-owner"],
    ["HTTP 403: Resource not accessible by personal access token (https://api.github.com/user/repos)", "forbidden", "GitHub did not accept this PC's sign-in.", "sign-in"],
    ["HTTP 422: Repository creation failed.: name is invalid (https://api.github.com/user/repos)", "invalid-name", "GitHub does not accept that name.", "rename"],
    ["GraphQL: Resource protected by organization SAML enforcement. You must grant your OAuth token access to this organization. (repository)", "sso", "This organization asks you to authorize Studio's GitHub sign-in first.", "details"],
    ["API rate limit exceeded for user ID 1.", "rate-limit", "GitHub asked Studio to slow down. Try again in a few minutes.", "retry"],
    ["GraphQL: Could not resolve to a Repository with the name 'o/n'. (repository)", "not-found", "GitHub could not find that repository.", "link"],
    ["HTTP 404: Not Found (https://api.github.com/repos/o/n)", "not-found", "GitHub could not find that repository.", "link"],
  ];
  for (const [stderr, kind, text, fix] of cases) {
    const result = git.classifyGh(stderr);
    assert.deepEqual({ kind: result.kind, text: result.text, fix: result.fix }, { kind, text, fix }, stderr);
  }
  assert.equal(git.classifyGh("GraphQL: Name already exists on this account (createRepository)", { repo: "nateecho32-stack/field-notes" }).text, "nateecho32-stack/field-notes already exists. Link to it, or pick another name.");
  assert.equal(git.classifyGh("error connecting to api.github.com", { action: "create" }).text, "You're offline. Nothing was created.");
  const scope = git.classifyGh("This API operation needs the \"read:org\" scope. To request it, run:  gh auth refresh -h github.com -s read:org");
  assert.deepEqual({ kind: scope.kind, text: scope.text, fix: scope.fix, scope: scope.scope }, { kind: "missing-scope", text: "Your GitHub sign-in needs one more permission.", fix: "add-permission", scope: "read:org" });
  const workflow = git.classifyGh("error: your authentication token is missing required scopes [workflow]\nTo request it, run:  gh auth refresh -s workflow");
  assert.equal(workflow.text, "Your GitHub sign-in cannot push workflow files.");
  assert.equal(workflow.scope, "workflow");
  const odd = git.classifyGh("gh: something unexpected happened");
  assert.deepEqual({ kind: odd.kind, text: odd.text, fix: odd.fix }, { kind: "unknown", text: "GitHub said: gh: something unexpected happened", fix: "details" });
  assert.equal(git.classifyGh("").text, "GitHub did not accept that.");
});

// ---- paths -----------------------------------------------------------------------------
test("secrets and generated folders are recognised by name", () => {
  const secret = (rule, label) => ({ kind: "secret", rule, label });
  const cases = [
    [".env", secret(".env*", "an environment file")],
    [".env.local", secret(".env*", "an environment file")],
    [".env.production", secret(".env*", "an environment file")],
    ["config/.env", secret(".env*", "an environment file")],
    ["apps\\web\\.env.development", secret(".env*", "an environment file")],
    [".ENV", secret(".env*", "an environment file")],
    ["certs/server.pem", secret("*.pem", "a private key file")],
    ["SERVER.PEM", secret("*.pem", "a private key file")],
    ["config/keys.key", secret("*.key", "a private key file")],
    ["id_rsa", secret("id_rsa*", "a private key file")],
    ["home/.ssh/id_rsa.pub", secret("id_rsa*", "a private key file")],
    ["id_ed25519", secret("id_rsa*", "a private key file")],
    ["auth.json", secret("auth.json", "a saved sign-in file")],
    ["data/Auth.json", secret("auth.json", "a saved sign-in file")],
    ["credentials.json", secret("credentials.json", "a saved sign-in file")],
    ["secrets/", secret("secrets/", "a secrets folder")],
    ["secrets/token.txt", secret("secrets/", "a secrets folder")],
    ["app/secrets/db.txt", secret("secrets/", "a secrets folder")],
    [".secrets/x", secret("secrets/", "a secrets folder")],
    ["node_modules/", { kind: "generated", rule: "node_modules/", label: "installed packages" }],
    ["node_modules/left-pad/index.js", { kind: "generated", rule: "node_modules/", label: "installed packages" }],
    ["packages/a/node_modules/b/c.js", { kind: "generated", rule: "node_modules/", label: "installed packages" }],
    ["dist/", { kind: "generated", rule: "dist/", label: "build output" }],
    ["dist/app.js", { kind: "generated", rule: "dist/", label: "build output" }],
    ["./dist/app.js", { kind: "generated", rule: "dist/", label: "build output" }],
  ];
  for (const [path, expected] of cases) assert.deepEqual(git.pathBlocked(path), expected, path);
  // A folder that is merely named like a secret file is still a folder: only its files are judged.
  assert.equal(git.pathBlocked(".env/"), null);
  for (const path of [
    "src/index.js", "README.md", ".env.example", ".env.sample", ".env.template", ".ENV.EXAMPLE", "docs/environment.md", "keyboard.md", "pem.txt", "keys.keyboard", "my.pem.txt",
    "mainauth.json", "credentials.json.md", "secretsauce/x", "distance/x.js", "src/dist.js", "node_modules.md", "sub/dist-info/x", "id_rs", "rsa_id", "", ".", "./", "\\", null, undefined,
  ]) assert.equal(git.pathBlocked(path), null, String(path));
});

test("a OneDrive folder is spotted from the environment or from its name", () => {
  const env = { OneDrive: "C:\\Users\\echor\\OneDrive", OneDriveConsumer: "C:\\Users\\echor\\OneDrive", OneDriveCommercial: "D:\\Work\\OneDrive - Contoso" };
  assert.equal(git.oneDrive("C:\\Users\\echor\\OneDrive\\Desktop\\Coding Projects\\Mefi's Studio AI+", env), true);
  assert.equal(git.oneDrive("c:/users/ECHOR/onedrive/Desktop/x", env), true, "case and slashes do not matter");
  assert.equal(git.oneDrive("C:\\Users\\echor\\OneDrive", env), true, "the root itself");
  assert.equal(git.oneDrive("C:\\Users\\echor\\OneDrive\\", env), true);
  assert.equal(git.oneDrive("D:\\Work\\OneDrive - Contoso\\Team\\app", env), true);
  assert.equal(git.oneDrive("C:\\Users\\echor\\Mefi Apps\\field-notes", env), false);
  assert.equal(git.oneDrive("C:\\Users\\echor\\OneDriveBackup\\x", { OneDrive: "C:\\Users\\echor\\OneDrive" }), false, "a sibling that only starts the same way");
  assert.equal(git.oneDrive("C:\\Users\\echor\\OneDrive2\\x", {}), false);
  // With no environment to ask, a folder named OneDrive (or OneDrive - <organization>) says it.
  assert.equal(git.oneDrive("C:\\Users\\echor\\OneDrive\\Desktop\\x", {}), true);
  assert.equal(git.oneDrive("/home/me/OneDrive - Contoso/app"), true);
  assert.equal(git.oneDrive("C:\\Users\\echor\\Documents\\x", undefined), false);
  assert.equal(git.oneDrive("", env), false);
  assert.equal(git.oneDrive(null, env), false);
  // An environment written the way Windows spells it (any case of the name) still counts.
  assert.equal(git.oneDrive("E:\\Sync\\Cloud\\x", { ONEDRIVE: "E:\\Sync\\Cloud" }), true);
  assert.equal(git.oneDrive("E:\\Sync\\Cloud\\x", { Path: "E:\\Sync\\Cloud" }), false, "only the OneDrive variables count");
});

test("a save the owner leaves unnamed says how many files", () => {
  assert.equal(git.saveMessage(4), "Studio save: 4 files");
  assert.equal(git.saveMessage(1), "Studio save: 1 file");
  assert.equal(git.saveMessage(12), "Studio save: 12 files");
  assert.equal(git.saveMessage(0), "Studio save");
  assert.equal(git.saveMessage(-2), "Studio save");
  assert.equal(git.saveMessage(undefined), "Studio save");
  assert.equal(git.saveMessage("3"), "Studio save: 3 files");
});

// ---- publishing -----------------------------------------------------------------------------
const plan = (over = {}) => git.publishPlan({ owner: "nateecho32-stack", name: "field-notes", ...over });
const ids = (result) => result.steps.map((step) => step.id);

test("publishing a folder with no Git is a fixed, ordered list of steps", () => {
  const result = plan({ license: "mit", holder: "Mefi", year: 2026, stacks: ["node"] });
  assert.equal(result.ok, true);
  assert.equal(result.repo, "nateecho32-stack/field-notes");
  assert.equal(result.visibility, "private", "private is the default");
  assert.deepEqual(ids(result), ["init", "ignore", "license", "save", "create", "push", "fetch", "upstream"]);
  assert.deepEqual(result.stages, [
    { id: "saving", label: "Saving a first commit" },
    { id: "creating", label: "Creating nateecho32-stack/field-notes" },
    { id: "uploading", label: "Uploading" },
  ]);
  const step = (id) => result.steps.find((item) => item.id === id);
  assert.deepEqual(step("init").argv, ["init", "-b", "main"]);
  assert.equal(step("ignore").path, ".gitignore");
  assert.equal(step("ignore").text, git.gitignoreFor(["node"]));
  assert.equal(step("ignore").skipIfExists, true);
  assert.equal(step("license").text, git.licenseText("mit", { holder: "Mefi", year: 2026 }));
  assert.deepEqual({ kind: step("save").kind, paths: step("save").paths, message: step("save").message }, { kind: "save", paths: "previewed", message: git.FIRST_MESSAGE });
  assert.deepEqual(step("create").argv, ["repo", "create", "nateecho32-stack/field-notes", "--private", "--source", ".", "--remote", "origin"]);
  assert.equal(step("create").kind, "gh");
  assert.deepEqual(step("push").argv, ["push", "-u", "origin", "main"]);
  assert.deepEqual(step("fetch").argv, ["fetch", "origin", "--prune"]);
  assert.deepEqual(step("upstream").argv, ["branch", "--set-upstream-to=origin/main", "main"]);
  // Steps of the same stage stay together, stages in order, and the long ones get long timeouts.
  assert.deepEqual(result.steps.map((item) => item.stage), ["saving", "saving", "saving", "saving", "creating", "uploading", "uploading", "uploading"]);
  assert.ok(step("create").timeoutMs >= 120000);
  assert.ok(step("push").timeoutMs >= 600000);
  assert.ok(step("init").timeoutMs > 0 && step("init").timeoutMs <= 60000);
  for (const item of result.steps) {
    assert.ok(item.label.length > 3, item.id);
    assert.ok(["git", "gh", "write", "save"].includes(item.kind), item.id);
    if (item.kind === "git" || item.kind === "gh") assert.ok(item.argv.every((part) => typeof part === "string" && part && !/[\r\n\0]/.test(part)), `${item.id}: argv is plain strings, for a process with no shell`);
    assert.ok(!("shell" in item));
  }
});

test("what is already true is not done again", () => {
  // A folder already on main with commits and a .gitignore of its own: only the license is written and saved.
  const licensed = plan({ isRepo: true, hasCommits: true, branch: "main", gitignore: false, license: "apache-2.0", holder: "Mefi", year: 2026 });
  assert.deepEqual(ids(licensed), ["license", "save", "create", "push", "fetch", "upstream"]);
  assert.deepEqual(licensed.steps.find((item) => item.id === "save").paths, "written");
  assert.equal(licensed.steps.find((item) => item.id === "save").label, "Saving LICENSE");
  const both = plan({ isRepo: true, hasCommits: true, branch: "main", license: "mit", year: 2026 });
  assert.equal(both.steps.find((item) => item.id === "save").label, "Saving .gitignore and LICENSE");
  assert.equal(both.steps.find((item) => item.id === "save").message, "Add .gitignore and LICENSE");
  const bare = plan({ isRepo: true, hasCommits: true, branch: "main", gitignore: false });
  assert.deepEqual(ids(bare), ["create", "push", "fetch", "upstream"]);
  assert.deepEqual(bare.stages.map((stage) => stage.id), ["creating", "uploading"]);
  // No commit yet: the first commit takes what the preview showed.
  const unborn = plan({ isRepo: true, unborn: true, hasCommits: false, branch: "main", gitignore: false });
  assert.deepEqual(ids(unborn), ["save", "create", "push", "fetch", "upstream"]);
  assert.equal(unborn.steps[0].paths, "previewed");
});

test("the branch is named main before anything is published", () => {
  const unbornMaster = plan({ isRepo: true, unborn: true, branch: "master" });
  assert.deepEqual(unbornMaster.steps[0], { timeoutMs: 30000, id: "init", stage: "saving", label: "Naming the branch main", kind: "git", argv: ["symbolic-ref", "HEAD", "refs/heads/main"] });
  const master = plan({ isRepo: true, hasCommits: true, branch: "master" });
  assert.deepEqual(master.steps[0].argv, ["branch", "-M", "main"]);
  const main = plan({ isRepo: true, hasCommits: true, branch: "main" });
  assert.notEqual(main.steps[0].id, "init");
  const detached = plan({ isRepo: true, hasCommits: true, detached: true, branch: null });
  assert.equal(detached.ok, false);
  assert.equal(detached.kind, "detached");
  assert.equal(detached.error, "This checkout is not on a branch. Start a branch here, then publish.");
});

test("a repository is private unless the exact owner/name is typed", () => {
  const publicWithout = plan({ visibility: "public" });
  assert.deepEqual({ ok: publicWithout.ok, kind: publicWithout.kind, error: publicWithout.error }, { ok: false, kind: "confirm-public", error: "Type nateecho32-stack/field-notes to make it public." });
  for (const typed of ["field-notes", "Nateecho32-Stack/field-notes", "nateecho32-stack/field-notes-2", "nateecho32-stack/field", "", undefined, null, "nateecho32-stack/field-notes/"]) {
    assert.equal(plan({ visibility: "public", confirmPublic: typed }).ok, false, String(typed));
  }
  const confirmed = plan({ visibility: "public", confirmPublic: "  nateecho32-stack/field-notes \n" });
  assert.equal(confirmed.ok, true);
  assert.equal(confirmed.visibility, "public");
  assert.ok(confirmed.steps.find((step) => step.id === "create").argv.includes("--public"));
  assert.ok(!confirmed.steps.find((step) => step.id === "create").argv.includes("--private"));
  // Typing the name changes nothing for a private repository, and a typo in the word is refused.
  assert.equal(plan({ confirmPublic: "whatever" }).steps.find((step) => step.id === "create").argv.includes("--private"), true);
  assert.equal(plan({ visibility: "Public", confirmPublic: "nateecho32-stack/field-notes" }).kind, "visibility");
  assert.equal(plan({ visibility: "secret" }).error, "Choose who can see it.");
  assert.equal(plan({ visibility: "" }).kind, "visibility");
});

test("a publish that cannot be planned says why", () => {
  assert.deepEqual(plan({ name: "" }), { ok: false, kind: "name", error: "Give the project a GitHub name." });
  assert.equal(plan({ name: "a b" }).kind, "name");
  assert.equal(plan({ name: "x.git" }).error, "A GitHub name cannot end with .git.");
  assert.equal(plan({ owner: "bad owner" }).kind, "name");
  assert.equal(plan({ owner: undefined, name: undefined }).kind, "name");
  assert.equal(git.publishPlan().kind, "name");
  assert.equal(plan({ license: "gpl" }).kind, "license");
  assert.equal(plan({ license: "MIT" }).ok, true, "license ids are case-blind");
  const linked = plan({ isRepo: true, hasCommits: true, branch: "main", hasRemote: true });
  assert.deepEqual({ ok: linked.ok, kind: linked.kind, error: linked.error }, { ok: false, kind: "has-remote", error: "This project already has a GitHub address. Studio never replaces it." });
});

test("the description is one clean line of at most 350 characters, passed as its own argument", () => {
  const create = (description) => plan({ description }).steps.find((step) => step.id === "create").argv;
  assert.deepEqual(create(""), ["repo", "create", "nateecho32-stack/field-notes", "--private", "--source", ".", "--remote", "origin"]);
  assert.deepEqual(create("  A notes   app\n\twith tabs\u0000 "), ["repo", "create", "nateecho32-stack/field-notes", "--private", "--source", ".", "--remote", "origin", "--description", "A notes app with tabs"]);
  const long = create("x".repeat(500));
  assert.equal(long.at(-1).length, 350);
  assert.equal(long.at(-2), "--description");
  assert.deepEqual(create("--public --delete-branch-on-merge").slice(-2), ["--description", "--public --delete-branch-on-merge"], "words that look like flags stay one value");
  assert.ok(!create("--public").slice(0, -2).includes("--public"));
});

test("a plan is data: the same input gives the same steps and nothing is shared between plans", () => {
  const first = plan({ license: "mit", year: 2026, holder: "Mefi", stacks: ["python"] });
  const second = plan({ license: "mit", year: 2026, holder: "Mefi", stacks: ["python"] });
  assert.deepEqual(first, second);
  first.steps[0].argv.push("--evil");
  first.stages.pop();
  assert.deepEqual(second, plan({ license: "mit", year: 2026, holder: "Mefi", stacks: ["python"] }));
  assert.deepEqual(JSON.parse(JSON.stringify(first)), first, "plain data that survives being sent between processes");
});

// ---- review fixes (S2): adversarial cases -------------------------------------------------------
test("a push that names a large file names the one over the limit, not the warning printed before it", () => {
  const raw = [
    "remote: warning: File cache/a.bin is 60.00 MB; this is larger than GitHub's recommended maximum file size of 50.00 MB",
    "remote: error: Trace: 1234",
    "remote: error: See https://gh.io/lfs for more information.",
    "remote: error: File data/b.bin is 150.25 MB; this exceeds GitHub's file size limit of 100.00 MB",
    "remote: error: GH001: Large files detected. You may want to try Git Large File Storage - https://git-lfs.github.com.",
    "error: failed to push some refs to 'https://github.com/o/n.git'",
  ].join("\n");
  const found = git.classifyPush(raw);
  assert.equal(found.kind, "too-large");
  assert.equal(found.file, "data/b.bin");
  assert.equal(found.mb, 150);
  assert.match(found.text, /^data\/b\.bin is 150 MB/);
  const only = git.classifyPush("remote: error: File x.bin is 101.00 MB; this exceeds GitHub's file size limit of 100.00 MB\nremote: error: GH001: Large files detected.");
  assert.equal(only.file, "x.bin");
  // A file that rounds to exactly 100.00 MB is still the one on the error line.
  const edge = git.classifyPush("remote: warning: File w.bin is 60.00 MB; this is larger than GitHub's recommended maximum\nremote: error: File e.bin is 100.00 MB; this exceeds GitHub's file size limit of 100.00 MB\nremote: error: GH001: Large files detected.");
  assert.equal(edge.file, "e.bin");
});

test("a rate limit is not a sign-in problem, whatever HTTP status carries it", () => {
  for (const raw of [
    "gh: API rate limit exceeded for user ID 1234 (HTTP 403)",
    "HTTP 403: You have exceeded a secondary rate limit. Please wait a few minutes before you try again.",
    "HTTP 429: Too Many Requests (https://api.github.com/user/repos)",
    "HTTP 403: was blocked by abuse detection mechanism",
  ]) {
    const cls = git.classifyGh(raw);
    assert.equal(cls.kind, "rate-limit", raw);
    assert.equal(cls.fix, "retry", raw);
  }
  assert.equal(git.classifyGh("HTTP 403: Resource not accessible by personal access token").kind, "forbidden", "a real refusal is still a refusal");
});

test("only a name GitHub says is taken is a taken name, not a git branch or remote that exists", () => {
  for (const raw of ["fatal: a branch named 'main' already exists", "error: remote origin already exists.", "fatal: destination path 'x' already exists and is not an empty directory."]) {
    const cls = git.classifyGh(raw, { repo: "o/n", action: "create" });
    assert.notEqual(cls.kind, "name-taken", raw);
    assert.equal(cls.fix, "details", raw);
  }
  assert.equal(git.classifyGh("GraphQL: Name already exists on this account (createRepository)").kind, "name-taken");
  assert.equal(git.classifyGh("HTTP 422: Repository o/n already exists").kind, "name-taken");
  assert.equal(git.classifyGh("GraphQL: acme does not have the correct permissions to execute `CreateRepository` (createRepository)").kind, "org-permission");
});

test("connection failures that curl on Windows, OpenSSL and Go word their own way are still offline", () => {
  for (const raw of [
    "fatal: unable to access 'https://github.com/o/n.git/': OpenSSL SSL_write: Connection was reset",
    "fatal: unable to access 'https://github.com/o/n.git/': Connection was reset",
    "fatal: unable to access 'https://github.com/o/n.git/': An existing connection was forcibly closed by the remote host.",
    "Post \"https://api.github.com/graphql\": read tcp 10.0.0.2:5->140.82.0.1:443: wsarecv: An existing connection was forcibly closed by the remote host.",
    "Post \"https://api.github.com/graphql\": context deadline exceeded (Client.Timeout exceeded while awaiting headers)",
    "Get \"https://api.github.com/user\": net/http: TLS handshake i/o timeout",
  ]) assert.equal(git.classifyGh(raw).kind, "offline", raw);
  const push = git.classifyPush("error: RPC failed; curl 56 OpenSSL SSL_read: Connection was reset, errno 10054");
  assert.deepEqual([push.kind, push.fix, push.state], ["offline", "retry", "offline"]);
});

test("scrub never throws and takes the header and environment shapes of a token", () => {
  const legacy = "0123456789abcdef".repeat(2) + "01234567";
  assert.equal(git.scrub(`Authorization: Bearer ${legacy}`), "Authorization: Bearer [token]");
  assert.equal(git.scrub(`authorization: token ${legacy} and more`), "authorization: token [token] and more");
  assert.equal(git.scrub(`GH_TOKEN=${legacy} gh repo view`), "GH_TOKEN=[token] gh repo view");
  assert.equal(git.scrub(`env GITHUB_TOKEN: ${legacy}`), "env GITHUB_TOKEN: [token]");
  assert.equal(git.scrub("https://bob:hunter2@github.com/o/n.git"), "https://github.com/o/n.git");
  for (const odd of [Object.create(null), { toString() { throw new Error("no"); } }, undefined, null]) assert.equal(git.scrub(odd), "");
  assert.doesNotThrow(() => git.scrub(Symbol("x")));
  assert.equal(git.classifyPush(Object.create(null)).kind, "unknown");
  assert.equal(git.classifyGh(Object.create(null)).kind, "unknown");
});

test("an account name cannot begin or end with a hyphen, and one that did would have been an option to gh", () => {
  for (const owner of ["-x", "x-", "-", "--", "-rf", `${"a".repeat(38)}-`]) {
    assert.equal(git.validRepo(owner, "x"), false, owner);
    assert.equal(plan({ owner, name: "x" }).kind, "name", owner);
  }
  for (const owner of ["x", "a-b", "a--b", "0", "A".repeat(39)]) assert.equal(git.validRepo(owner, "x"), true, owner);
  const argv = plan({ owner: "o-1", name: "-x" }).steps.find((step) => step.id === "create").argv;
  assert.match(argv[2], /^[A-Za-z0-9]/, "the repository argument never starts like an option");
});

test("more secret file names and folders are stopped, however Windows spells them", () => {
  const secret = (rule, label) => ({ kind: "secret", rule, label });
  const login = (rule) => secret(rule, "a saved sign-in file");
  const key = (rule) => secret(rule, "a private key file");
  const folder = (rule) => secret(rule, "a credentials folder");
  const generated = (rule, label) => ({ kind: "generated", rule, label });
  const cases = [
    [".netrc", login(".netrc")], ["home/_netrc", login(".netrc")], [".git-credentials", login(".git-credentials")], [".pypirc", login(".pypirc")],
    [".pgpass", login(".pgpass")], ["web/.htpasswd", login(".htpasswd")],
    ["certs/app.pfx", key("*.pfx")], ["a/b.P12", key("*.pfx")], ["putty.ppk", key("*.ppk")], ["android/release.keystore", key("*.keystore")], ["release.JKS", key("*.keystore")],
    ["x/.aws/credentials", folder(".aws/")], [".ssh/config", folder(".ssh/")], ["x/.gnupg/", folder(".gnupg/")], [".SSH/known_hosts", folder(".ssh/")],
    [".ssh/id_rsa", key("id_rsa*")],
    ["server.pem.", key("*.pem")], ["server.pem ", key("*.pem")], ["Server.PEM::$DATA", key("*.pem")],
    [".env.", secret(".env*", "an environment file")], ["dir\\.env ", secret(".env*", "an environment file")], ["config/.env::$DATA", secret(".env*", "an environment file")],
    ["Node_Modules/x.js", generated("node_modules/", "installed packages")], ["DIST/app.js", generated("dist/", "build output")], ["a/NODE_MODULES/", generated("node_modules/", "installed packages")],
  ];
  for (const [path, expected] of cases) assert.deepEqual(git.pathBlocked(path), expected, path);
  for (const path of ["ssh/config", "aws/readme.md", "netrc.md", "my.pfx.txt", "keystore.md", ".ssh.md", "gnupg/x", "src/.env.example", "docs/.netrc.md", 12, {}, [], Symbol("x")]) {
    assert.equal(git.pathBlocked(path), null, String(typeof path === "symbol" ? "symbol" : JSON.stringify(path)));
  }
});

test("an outcome or a refusal named like an object property is ignored, not read as one", () => {
  for (const kind of ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"]) {
    const done = git.describe({ glance: glance({ ahead: 1 }), outcome: { kind, commits: 1 } });
    assert.equal(done.id, "ahead", kind);
    const refused = git.describe({ glance: glance({ ahead: 1 }), refusal: { kind, text: "no" } });
    assert.doesNotMatch(refused.sentence, /native code|function/, kind);
    assert.doesNotMatch(JSON.stringify(refused), /native code/, kind);
  }
  assert.equal(git.describe({ glance: glance({ ahead: 1 }), outcome: { kind: 7 } }).id, "ahead");
  assert.equal(git.describe({ glance: glance({ ahead: 1 }), refusal: { kind: {} } }).id, "ahead");
});

test("while a check failed, a push was held back or a secret stopped it, nothing offered pushes or publishes", () => {
  const pushy = new Set(["push", "save-and-push", "push-branch", "publish", "rebase", "pull-anyway"]);
  const dashes = "——";
  const stops = [
    { glance: glance({ ahead: 2 }), sync: syncOf([problem("check-failed", { detail: "3 failing" })]) },
    { glance: glance({ ahead: 2, dirty: 4 }), sync: syncOf([problem("check-failed", { detail: "3 failing" })]) },
    { glance: glance({ upstream: null }), sync: syncOf([problem("check-failed", { detail: "x" })]) },
    { glance: glance({ branch: "feat", onDefault: false, upstream: null, ahead: 1 }), sync: syncOf([problem("check-failed", { detail: "x" })]) },
    { glance: glance({ ahead: 1 }), sync: syncOf([problem("lost-work", { detail: "Nothing was pushed. Merge abc1234 (x) left out 3 lines of 1 file another branch changed (a.js).", findings: [] })]) },
    { glance: glance({ ahead: 1 }), refusal: git.classifyPush(`remote: error: GITHUB PUSH PROTECTION\nremote:   ${dashes} GitHub Personal Access Token ${dashes}\nremote:   path: .env:3`) },
    { glance: glance({ ahead: 1 }), refusal: git.classifyPush("remote: error: File big.bin is 150.00 MB; this exceeds GitHub's file size limit of 100.00 MB\nremote: error: GH001: Large files detected.") },
    { glance: glance({ ahead: 1 }), sync: syncOf([problem("fetch-failed", { detail: "boom" })]) },
    { glance: glance({ ahead: 1 }), account: null },
    { glance: glance({ ahead: 1 }), busy: "pushing" },
  ];
  for (const input of stops) {
    const model = git.describe(input);
    for (const offered of [model.primary, model.secondary]) if (offered) assert.ok(!pushy.has(offered.id), `${model.id} offers ${offered.id}`);
  }
});

test("real situations read as what they are: a fresh init, master, a detached head, files on top of commits", () => {
  const fresh = git.describe({ glance: glance({ unborn: true, branch: "master", main: "master", remote: null, upstream: null, dirty: 5 }) });
  assert.deepEqual([fresh.id, fresh.primary.id, fresh.branch], ["no-commits", "save-first", "master"]);
  const master = git.describe({ glance: glance({ branch: "master", main: "master", upstream: "origin/master", ahead: 1 }) });
  assert.deepEqual([master.id, master.primary.label, master.details[0]], ["ahead", "Push 1 commit", "1 commit on master not pushed yet."]);
  const detached = git.describe({ glance: glance({ detached: true, branch: null, onDefault: false, upstream: null, dirty: 2 }) });
  assert.deepEqual([detached.id, detached.label, detached.primary.id, detached.branch], ["other-branch", "Not on a branch", "start-branch", null]);
  const stacked = git.describe({ glance: glance({ ahead: 2, dirty: 3 }) });
  assert.deepEqual([stacked.id, stacked.primary.id, stacked.secondary.id, stacked.secondary.confirm], ["ahead", "save-and-push", "push", true]);
  const behindDirty = git.describe({ glance: glance({ behind: 2, dirty: 3 }) });
  assert.deepEqual([behindDirty.id, behindDirty.primary.id], ["behind", "pull"]);
  assert.ok(behindDirty.details.includes("3 uncommitted files in this checkout."));
  const divergedDirty = git.describe({ glance: glance({ ahead: 1, behind: 1, dirty: 2 }) });
  assert.deepEqual([divergedDirty.id, divergedDirty.primary.id], ["diverged", "save"], "commit first, then put the commits on top");
  const building = git.describe({ glance: glance({ behind: 1 }), agentsBuilding: true });
  assert.deepEqual([building.id, building.primary.id, building.secondary.id], ["agents-working", "pull-anyway", "wait"]);
  const other = git.describe({ glance: glance({ remote: "other", ahead: 3, dirty: 1 }) });
  assert.deepEqual([other.id, other.primary], ["other-remote", null]);
});

test("a megabyte of git output cannot hold the app up: scrub and the classifiers stay linear", () => {
  const timed = (label, run, expected) => {
    const started = process.hrtime.bigint();
    const result = run();
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    assert.ok(ms < 1500, `${label} took ${Math.round(ms)} ms`);
    if (expected !== undefined) assert.equal(result?.kind, expected, label);
  };
  // 80 KB of letters used to take 8 s in scrub alone (a pattern that began at every letter of a word).
  timed("scrub one long word", () => git.scrub("x".repeat(1_000_000)));
  timed("scrub dotted word", () => git.scrub("a.b-".repeat(250_000)));
  timed("scrub scheme spam", () => git.scrub("https://".repeat(200_000) + "a@b"));
  timed("scrub token spam", () => git.scrub("ghp_".repeat(250_000)));
  timed("scrub header spam", () => git.scrub("authorization ".repeat(100_000)));
  timed("push, reason at the end", () => git.classifyPush(`${"x".repeat(2_000_000)}\nremote: Repository not found.`), "not-found");
  timed("push, file spam", () => git.classifyPush(`${"File ".repeat(100_000)}\nremote: error: GH001: Large files detected.`), "too-large");
  timed("push, path spam", () => git.classifyPush(`${"path:".repeat(100_000)}\nGITHUB PUSH PROTECTION`), "secret");
  timed("push, refusing spam", () => git.classifyPush("refusing to allow ".repeat(100_000)), "unknown");
  timed("gh, scope spam", () => git.classifyGh("missing required scopes ".repeat(100_000)), "unknown");
  timed("describe over huge problem text", () => git.describe({ glance: glance({ ahead: 1 }), sync: syncOf([problem("push-refused", { stderr: "File ".repeat(100_000) + "GH001" }), problem("offline", { detail: "x".repeat(2_000_000) })]) }));
  assert.equal(git.scrub("https://bob:hunter2@github.com/o/n.git"), "https://github.com/o/n.git");
  assert.equal(git.scrub("ssh://git@github.com/o/n.git and https://github.com/o/n.git/x@y"), "ssh://github.com/o/n.git and https://github.com/o/n.git/x@y");
});

// ---- the module keeps its promise -------------------------------------------------------------
test("the module says it is pure and loads without touching anything", async () => {
  const source = await read("scripts/git-link.cjs");
  assert.ok(source.slice(0, 4000).includes("Pure module: no Electron, no filesystem, no network, no clock reads."));
  assert.doesNotMatch(source.split("\n").filter((line) => !/^\s*\/\//.test(line)).join("\n"), /require\(\s*["'](?:node:)?(?:fs|child_process|http|https|net|os)|process\.(?:env|platform|cwd)|Date\.now|new Date\(|setTimeout|setInterval/);
  assert.deepEqual(Object.keys(git).sort(), [
    "ACTION_IDS", "FIRST_MESSAGE", "LICENSE_IDS", "OUTCOMES", "STATES", "STATE_IDS", "chip", "classifyGh", "classifyPush", "describe", "gitignoreFor", "licenseText", "nameSuggestions",
    "oneDrive", "pathBlocked", "publishPlan", "repoIssue", "repoName", "saveMessage", "scrub", "validRepo",
  ]);
});
