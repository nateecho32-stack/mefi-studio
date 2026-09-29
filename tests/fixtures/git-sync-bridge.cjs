"use strict";
// A fake of the git:* half of window.mefiStudio for renderer/git-sync.js: the
// chip model of every state in the boards' vocabulary (label, tone, glyph and
// the sentence the host would send), and the bridge methods the chip, its
// popover and its dialogs call, each recording what it was asked and answering
// with a plausible reply. tests/git_sync_ui.test.mjs drives it in a vm; a later
// Electron capture can reuse it in a page: pageSource(options) is an expression
// that evaluates to the same api object there (options must be plain data), and
// pageKitSource() one that evaluates to the whole kit.
//
//   const kit = require("./git-sync-bridge.cjs");
//   const fake = kit.createFakeGitBridge({ state: "ahead" });
//   fake.api.gitPush({})            // recorded in fake.calls, answers with a success model
//   fake.hold("gitPush")            // the next gitPush waits until fake.release("gitPush")
//   fake.push(kit.sampleModel("behind"))   // what main pushes on git:state
//
// The rows here are sample data written from the design brief (section 3), not
// scripts/git-link.cjs: the renderer is held to drawing whatever model it is
// handed, so a change to the host's wording never breaks this suite.

function factory() {
    // id: label, tone, glyph, sentence, busy kind, primary [id, label, confirm], secondary [id, label], counts
  const ROWS = {
    "not-repo": ["Not a repo", "neutral", "not-repo", "This project folder is not a Git repository, so there is nothing to sync.", null, ["setup-git", "Set up Git and GitHub", false], ["not-now", "Not now"], {}],
    "no-commits": ["No commits yet", "neutral", "no-commits", "No commits yet. Save a first commit, then publish.", null, ["save-first", "Save a first commit", false], ["publish-later", "Publish later"], {}],
    "no-remote": ["Only on this PC", "neutral", "no-remote", "This project is only on this PC. Publish it to GitHub once to link your PCs.", null, ["publish", "Publish to GitHub", false], ["link", "Link to a repo I already have"], {}],
    "other-remote": ["Linked elsewhere", "neutral", "other-remote", "This project's origin is not on GitHub, so Studio leaves it alone.", null, null, ["show-address", "Show address"], {}],
    "signed-out": ["Sign in", "warn", "signed-out", "Sign in to GitHub first.", null, ["sign-in", "Sign in to GitHub", false], ["not-now", "Not now"], {}],
    checking: ["Checking…", "neutral", "checking", "Looking at GitHub. Nothing is being changed.", "checking", null, null, {}],
    "in-sync": ["In sync", "good", "in-sync", "This PC matches GitHub main.", null, ["check", "Check GitHub", false], ["open-github", "Open on GitHub"], {}],
    ahead: ["2 to push", "info", "ahead", "Some work on this PC is not on GitHub yet.", null, ["push", "Push 2 commits", true], ["show-push", "Show what will be pushed"], { ahead: 2 }],
    behind: ["3 to pull", "info", "behind", "GitHub has 3 commits this PC has not pulled yet.", null, ["pull", "Pull 3 commits", false], ["show-changes", "Show what changed"], { behind: 3 }],
    diverged: ["Both changed", "warn", "diverged", "main changed on this PC and on GitHub. Put this PC's commits on top of GitHub's, then sync.", null, ["rebase", "Put my commits on top of GitHub's", true], ["ask-mefi-combine", "Ask Mefi to combine them"], { ahead: 2, behind: 3 }],
    uncommitted: ["4 changes", "info", "uncommitted", "4 uncommitted files in this checkout.", null, ["save-and-push", "Save and push 4 files", false], ["save", "Save only"], { dirty: 4 }],
    "other-branch": ["On wip/cli", "warn", "other-branch", "This checkout is on wip/cli, not main.", null, ["push", "Push this branch", true], ["details", "Details"], { ahead: 1 }],
    "no-upstream": ["Not pushed yet", "info", "no-upstream", "GitHub has no origin/main yet. Push main once to link your PCs.", null, ["push", "Push main to GitHub", true], ["open-github", "Open on GitHub"], {}],
    offline: ["Offline", "neutral", "offline", "GitHub could not be reached. As of the last check, this PC matched GitHub.", null, ["retry", "Try again", false], ["save", "Save on this PC"], {}],
    "fetch-failed": ["Can't check GitHub", "bad", "fetch-failed", "Couldn't check GitHub (authentication failed). Sign in to GitHub again or check this project's GitHub address; nothing was changed.", null, ["sign-in", "Sign in again", false], ["retry", "Try again"], {}],
    "agents-working": ["Agents building", "info", "agents-working", "Agents are still changing files in this project. Pull now anyway?", null, ["pull-anyway", "Pull now", false], ["wait", "Wait"], { behind: 1 }],
    saving: ["Saving…", "info", "saving", "Saving 4 files on this PC.", "saving", null, null, {}],
    pushing: ["Pushing…", "info", "pushing", "Pushing 2 commits on main.", "pushing", null, ["details", "Details"], { ahead: 2 }],
    pulling: ["Pulling…", "info", "pulling", "Getting 3 commits from GitHub…", "pulling", null, null, { behind: 3 }],
    publishing: ["Publishing…", "info", "publishing", "Creating the repository and uploading the project.", "publishing", null, null, {}],
    "check-failed": ["Check failed", "bad", "check-failed", "The project's check failed, so nothing was pushed. Fix it, then sync again.", null, ["ask-mefi-fix", "Ask Mefi to fix it", false], ["show-output", "Show check output"], { ahead: 2 }],
    "lost-work": ["Held back", "bad", "lost-work", "Nothing was pushed. Merge 3f9c2ab (Merge wip/site-rebuild) left out 214 lines of 2 files another branch changed (scripts/sync.mjs, renderer/pc-sync.js). Restore them, or if that was deliberate say so with a \"Lost-work-ok: <why>\" line in a commit message.", null, ["ask-mefi-restore", "Ask Mefi to restore them", false], ["show-files", "Show the files"], { ahead: 2 }],
    conflict: ["Needs merging", "bad", "conflict", "Your commits and GitHub's both change scripts/sync.mjs, renderer/pc-sync.js. Nothing was changed; merge them by hand or ask Mefi.", null, ["ask-mefi-merge", "Ask Mefi to merge", false], ["open-folder", "Open the folder"], { ahead: 2, behind: 3 }],
    "push-refused": ["GitHub said no", "bad", "push-refused", "GitHub has newer work. Pull first.", null, ["pull", "Pull, then push", false], ["details", "Details"], { ahead: 2 }],
    "blocked-secret": ["Stopped", "bad", "blocked-secret", "Stopped: a private key in config/keys.txt.", null, ["leave-out", "Leave that file out", false], ["show-where", "Show where"], {}],
    "too-large": ["File too big", "warn", "too-large", "installer.exe is 62 MB; GitHub refuses files over 100 MB.", null, ["leave-out-ignore", "Leave it out and ignore it", false], ["show-file", "Show the file"], {}],
    "folder-missing": ["Folder missing", "warn", "folder-missing", "That project folder is unavailable. Reconnect it before switching.", null, ["find-folder", "Find the folder", false], ["remove", "Remove from list"], {}],
    unknown: ["Not checked", "neutral", "unknown", "Git state not read yet.", null, null, null, {}],
    success: ["Done", "good", "success", "Pushed 2 commits to GitHub.", null, ["open-github", "Open on GitHub", false], ["done", "Done"], {}],
    "pull-refused": ["Can't pull now", "warn", "pull-refused", "Could not fast-forward main (uncommitted edits in the way?): error: Your local changes would be overwritten by merge:", null, ["save", "Save my changes", false], ["show-files", "Show the files"], { behind: 1, dirty: 2 }],
    error: ["Sync did not run", "bad", "error", "Sync could not run: something went wrong.", null, ["retry", "Try again", false], ["details", "Details"], {}],
  };
  const STATE_IDS = Object.keys(ROWS);
  // What the host lists under the sentence: hints, the numbers again, and the steps of a working state.
  const DETAILS = {
    ahead: ["2 commits on main not pushed yet."],
    behind: ["3 commits on main not pulled yet."],
    diverged: ["2 commits on this PC not on GitHub.", "3 commits on GitHub not on this PC.", "Both sets of work stay. If the same lines clash, nothing is changed."],
    uncommitted: ["Uncommitted files stay on this PC unless you save them."],
    "no-remote": ["You choose the name and who can see it next. Private is the default."],
    "signed-out": ["You sign in on GitHub's own page. Studio never asks for your password."],
    pushing: ["Checking nothing was left out", "Running the project's check", "Uploading 2 commits"],
    publishing: ["Saving a first commit", "Creating nateecho32-stack/mefi-studio", "Uploading"],
    "check-failed": ["npm run check: tests/sync.test.mjs: push waits for the project's check"],
  };

  // The chip model the host describes (scripts/git-link.cjs describe()).
  function sampleModel(id, over = {}) {
    const row = ROWS[id];
    if (!row) throw new Error(`no sample state ${id}`);
    const [label, tone, glyph, sentence, busy, primary, secondary, counts] = row;
    const linked = !["not-repo", "no-commits", "no-remote", "other-remote", "signed-out", "folder-missing", "unknown"].includes(id);
    return {
      id, label, short: ["ahead", "behind", "uncommitted"].includes(id) ? String(counts.ahead ?? counts.behind ?? counts.dirty) : "", tone, glyph, sentence,
      details: DETAILS[id] ? [...DETAILS[id]] : [],
      branch: id === "other-branch" ? "wip/cli" : id === "not-repo" ? "" : "main",
      repo: linked || id === "signed-out" ? "nateecho32-stack/mefi-studio" : "",
      checkedAt: linked ? Date.now() - 3 * 60 * 1000 : null,
      counts: { ahead: 0, behind: 0, dirty: 0, ...counts },
      primary: primary ? { id: primary[0], label: primary[1], confirm: primary[2] === true } : null,
      secondary: secondary ? { id: secondary[0], label: secondary[1] } : null,
      busy,
      ...over,
    };
  }

  const clone = (value) => JSON.parse(JSON.stringify(value ?? null));
  const slug = (text) => String(text ?? "").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 100);

  function createFakeGitBridge(options = {}) {
    const calls = [];
    const listeners = { git: [], projects: [] };
    const holds = new Set();
    const pending = [];
    const world = { model: sampleModel(options.state ?? "ahead", options.over ?? {}), account: options.account === undefined ? "nateecho32-stack" : options.account, ghInstalled: options.ghInstalled !== false, gitInstalled: options.gitInstalled !== false, taken: options.taken ?? [] };
    const success = (sentence, over = {}) => sampleModel("success", { sentence, branch: "main", repo: "nateecho32-stack/mefi-studio", checkedAt: Date.now(), ...over });
    const defaults = {
      gitState: () => ({ ok: true, model: clone(world.model) }),
      gitCheck: () => { world.model = { ...world.model, checkedAt: Date.now() }; return { ok: true, model: clone(world.model) }; },
      gitPull: () => ({ ok: true, model: success("Pulled 3 commits from GitHub.") }),
      gitPush: () => ({ ok: true, model: success("Pushed 2 commits to GitHub.") }),
      gitRebase: () => ({ ok: true, model: success("Put 2 commits from this PC on top of GitHub's.") }),
      gitSavePreview: () => ({
        ok: true, branch: "main", message: "Studio save: 4 files", identity: { ok: true, name: "Nate", email: "nate@example.test", fromAccount: false }, refusal: null, builders: false, unborn: false, detached: false,
        files: [
          { path: "scripts/sync.mjs", status: "changed", bytes: 4100, include: true },
          { path: "renderer/pc-sync.js", status: "changed", bytes: 9800, include: true },
          { path: "docs/github-linking.md", status: "new", bytes: 1200, include: true },
          { path: "old-notes.txt", status: "deleted", bytes: 0, include: true },
          { path: "installer.exe", status: "new", bytes: 62000000, include: false, warn: { kind: "large", label: "62 MB", text: "installer.exe is 62 MB. GitHub warns about files over 50 MB.", mb: 62 } },
          { path: "config/keys.txt", status: "new", bytes: 400, include: false, blocked: { kind: "secret", rule: "*.txt", label: "a private key file", text: "Stopped: a private key file in config/keys.txt." } },
        ],
      }),
      gitSave: (payload) => ({ ok: true, sha: "abc1234", files: (payload?.paths ?? []).length, pushed: payload?.push === true, model: success(payload?.push ? "Pushed 1 commit to GitHub." : "Saved on this PC.") }),
      gitOwners: () => (world.account ? { ok: true, account: world.account, orgs: ["void-engine"] } : { ok: false, error: "Sign in to GitHub first." }),
      gitPublishPreview: (input) => {
        const name = slug(input?.name);
        const repo = `${input?.owner}/${name}`;
        return {
          ok: true, repo, valid: name.length > 0, sanitized: name, taken: world.taken.includes(repo), issue: name.length > 0 ? null : "Give the project a GitHub name.", suggestions: world.taken.includes(repo) ? [`${name}-2`, `${name}-3`] : [],
          files: [{ path: "src/main.js", bytes: 900 }, { path: "src/util.js", bytes: 400 }, { path: "assets/logo.png", bytes: 20000 }, { path: "README.md", bytes: 300 }], total: 4, truncated: false, warn: [], blocked: [],
          oneDrive: false, weakDrive: false, filesystem: "NTFS", renameBranch: false, needsSignIn: false, ghInstalled: true, account: world.account, needsFirstCommit: true, isRepo: true, branch: "main", remote: null, publishIssue: null,
        };
      },
      gitPublish: (input) => ({ ok: true, repo: `${input?.owner}/${input?.name}`, url: `https://github.com/${input?.owner}/${input?.name}`, steps: [{ id: "commit", label: "Saving a first commit", ok: true }, { id: "create", label: `Creating ${input?.owner}/${input?.name}`, ok: true }, { id: "push", label: "Uploading", ok: true }], model: success(`Published ${input?.owner}/${input?.name}.`, { repo: `${input?.owner}/${input?.name}` }) }),
      gitLinkRepos: () => ({ ok: true, repos: [
        { repo: "nateecho32-stack/mefi-studio", private: false, description: "Mefi's Studio AI+", updatedAt: "2026-09-28T10:00:00Z" },
        { repo: "nateecho32-stack/field-notes", private: true, description: "", updatedAt: "2026-09-20T10:00:00Z" },
        { repo: "void-engine/void-engine-bot", private: true, description: "The bot", updatedAt: "2026-09-01T10:00:00Z" },
      ] }),
      gitLink: (repo) => ({ ok: true, model: sampleModel("in-sync", { repo }) }),
      githubAccount: () => ({ ok: true, account: world.account, ghInstalled: world.ghInstalled, gitInstalled: world.gitInstalled }),
      pcSetupAction: () => ({ ok: true, launched: true, message: "Finish in the setup window, then choose Check again." }),
      projectsList: () => ({ ok: true, projects: [{ id: "p1", name: "Mefi's Studio AI+" }], activeId: "p1" }),
      projectsAdd: () => ({ ok: true }),
      openExternal: () => ({ ok: true }),
    };
    const replies = { ...(options.replies ?? {}) };
    // What an action answers with becomes the chip's model from then on, as it does in main.
    const MODEL_ACTIONS = new Set(["gitCheck", "gitPull", "gitPush", "gitRebase", "gitLink", "gitSave", "gitPublish"]);
    const answer = (name, args) => {
      const chosen = replies[name];
      const value = typeof chosen === "function" ? chosen(...args) : chosen !== undefined ? chosen : defaults[name](...args);
      if (MODEL_ACTIONS.has(name) && value?.ok && value.model) world.model = clone(value.model);
      return clone(value);
    };
    const method = (name) => (...args) => {
      calls.push([name, clone(args)]);
      if (holds.has(name)) return new Promise((resolve) => { pending.push({ name, resolve, args }); });
      return Promise.resolve(answer(name, args));
    };
    const api = {};
    for (const name of Object.keys(defaults)) api[name] = method(name);
    api.onGitState = (callback) => { listeners.git.push(callback); };
    api.onProjects = (callback) => { listeners.projects.push(callback); };
    return {
      api, calls, world,
      names: () => calls.map(([name]) => name),
      last: (name) => calls.filter(([called]) => called === name).at(-1)?.[1] ?? null,
      // Push what main sends on git:state.
      push: (model) => { world.model = clone(model); for (const callback of listeners.git) callback(clone(model)); },
      hold: (name) => { holds.add(name); },
      release: (name, value) => {
        holds.delete(name);
        const at = pending.findIndex((item) => item.name === name);
        if (at < 0) return false;
        const [item] = pending.splice(at, 1);
        item.resolve(value !== undefined ? clone(value) : answer(name, item.args));
        return true;
      },
      setAccount: (account) => { world.account = account; },
      pending: () => pending.map((item) => item.name),
    };
  }
  return { STATE_IDS, ROWS, sampleModel, createFakeGitBridge };
}

const kit = factory();
module.exports = {
  ...kit,
  // An expression for a page: the same api object, fresh, from plain-data options.
  pageSource: (options = {}) => `(${factory.toString()})().createFakeGitBridge(${JSON.stringify(options)}).api`,
  // The whole kit (sampleModel and createFakeGitBridge) as an expression, for a page that also pushes states.
  pageKitSource: () => `(${factory.toString()})()`,
};
