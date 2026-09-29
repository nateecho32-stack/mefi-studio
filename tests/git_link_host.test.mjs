import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import test from "node:test";
import vm from "node:vm";

// The GitHub link's wiring in main.cjs and preload.cjs (scripts/git-host.cjs
// does the work and has its own suite): the inert top-level block that gives the
// launch screen `available` and `openedAt`, the typeof-guarded hook that hands
// syncProject's answers to the Git chip, the handlers registered beside the
// pc-setup ones and which of them wait for a project switch, the factory
// arguments main.cjs passes, and the bridge, which forwards named plain fields
// and never a folder, a command or an address. See main.cjs "GitHub link".

const require = createRequire(import.meta.url);
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const preload = (await readFile(new URL("../preload.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const plain = (value) => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); };

function slice(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  assert.ok(from > 0 && to > from, `main.cjs has ${start}`);
  return text.slice(from, to);
}
const banner = slice(main, "// ---- GitHub link: the Git chip, Save and push, Publish and Link", "// ---- end of the GitHub link");

function launchHost({ settings = {}, folders = [] } = {}) {
  const store = structuredClone(settings);
  const context = vm.createContext({
    Object, Number, Array, Date, Promise,
    existsSync: (folder) => folders.includes(folder),
    readSettings: async () => store,
    updateSettings: async (change) => { const result = change(store); if (result !== false) store.saved = (store.saved ?? 0) + 1; },
  });
  vm.runInContext(`${banner}\nthis.api = { projectLaunchFacts, stampProjectOpened, hooks: () => gitHostHooks };`, context);
  return { api: context.api, store };
}

test("the top-level block is inert when it loads, and stands in no other suite's slice", () => {
  const h = launchHost();
  assert.equal(h.api.hooks(), null, "no hook until registerIpc sets one");
  assert.equal(h.store.saved, undefined, "loading wrote nothing");
  assert.doesNotMatch(banner, /^(?!\s*\/\/)[^\n]*\b(require|app\.|ipcMain|loadModule)\(/m, "no work at load time");
  // The sync suite slices "Multi-PC sync" up to "end of multi-PC sync"; this block sits after it.
  assert.ok(main.indexOf("// ---- end of multi-PC sync") < main.indexOf("// ---- GitHub link: the Git chip"));
  assert.ok(main.indexOf("// ---- GitHub link: the Git chip") < main.indexOf("// ---- Your PCs vault: memory and setup"));
});

test("projects carry whether their folder is still there and when they were opened", async () => {
  const h = launchHost({ settings: { projectOpened: { a: 1700000000000, b: "yesterday" } }, folders: ["C:/apps/a"] });
  const list = { activeId: "a", projects: [{ id: "a", name: "A", path: "C:/apps/a" }, { id: "b", name: "B", path: "C:/apps/gone" }, { id: "c", name: "C" }] };
  const out = plain(await h.api.projectLaunchFacts(list));
  assert.equal(out.activeId, "a", "the rest of the answer is untouched");
  assert.deepEqual(out.projects.map((p) => [p.id, p.available, p.openedAt]), [["a", true, 1700000000000], ["b", false, null], ["c", false, null]], "a missing folder, a bad stamp and a missing path all read as unavailable or never opened");
  assert.deepEqual(plain(await h.api.projectLaunchFacts(null)), null);
  assert.deepEqual(plain(await h.api.projectLaunchFacts({ ok: false })), { ok: false });
});

test("opening a project stamps it, and only the newest 200 are kept", async () => {
  const many = Object.fromEntries(Array.from({ length: 200 }, (_, index) => [`p${index}`, 1000 + index]));
  const h = launchHost({ settings: { projectOpened: many } });
  await h.api.stampProjectOpened("fresh");
  const kept = Object.keys(h.store.projectOpened);
  assert.equal(kept.length, 200);
  assert.ok(kept.includes("fresh"), "the new stamp is kept");
  assert.ok(!kept.includes("p0"), "the oldest goes");
  assert.ok(Number.isFinite(h.store.projectOpened.fresh));
  const before = h.store.saved;
  await h.api.stampProjectOpened("");
  await h.api.stampProjectOpened(null);
  await h.api.stampProjectOpened(42);
  assert.equal(h.store.saved, before, "no id, no write");
});

test("syncProject hands every answer to the Git chip through a guard, and works without it", async () => {
  const block = slice(main, "// ---- Multi-PC sync: Friends › Your PCs", "// ---- end of multi-PC sync");
  const run = async (withHook) => {
    const sent = [], heard = [];
    const context = vm.createContext({
      Promise, Number, Boolean, String, Array, JSON,
      SMOKE: false, CAPTURE: false, CLI_MODE: false, projectSwitching: false,
      projectRoot: () => "C:/projects/one",
      send: (channel, payload) => sent.push(channel),
      readSettings: async () => ({}), autopilot: { jobs: [] }, coworkPushed: () => {},
      loadModule: async () => ({ projectCheck: async () => null, sync: async (folder) => ({ ok: true, headline: "ok", lines: [], pending: [], actions: [], problems: [], risk: 0, state: { root: folder } }) }),
    });
    if (withHook) context.gitHostHooks = { onSyncEvent: (result) => heard.push(result.state.root) };
    vm.runInContext(`${block}\nthis.api = { syncProject };`, context);
    const result = await context.api.syncProject(false);
    await flush();
    return { result, sent, heard };
  };
  const hooked = await run(true);
  assert.deepEqual(hooked.sent, ["sync:event"]);
  assert.deepEqual(hooked.heard, ["C:/projects/one"], "the chip hears the same answer the badge does");
  const bare = await run(false);
  assert.equal(bare.result.ok, true, "a suite or a build without the hook still syncs");
  assert.deepEqual(bare.sent, ["sync:event"]);
});

test("the handlers sit beside the pc-setup ones, and only the launch calls skip a project switch", () => {
  const registered = [...main.matchAll(/ipcMain\.handle\("((?:git|pc-setup:account|projects:glance)[^"]*)"/g)].map((match) => match[1]);
  for (const channel of ["git:state", "git:check", "git:pull", "git:push", "git:rebase", "git:save-preview", "git:save", "git:owners", "git:publish-preview", "git:publish", "git:link-repos", "git:link", "pc-setup:account", "projects:glance"]) {
    assert.equal(registered.filter((item) => item === channel).length, 1, `${channel} is registered once`);
  }
  const prefixes = main.match(/const APP_WIDE_PREFIXES = \[([^\]]*)\]/)[1];
  const channels = main.match(/const APP_WIDE_CHANNELS = new Set\(\[([^\]]*)\]\)/)[1];
  assert.doesNotMatch(prefixes, /"git:"/, "git:* acts on the open project, so a switch waits for it");
  assert.doesNotMatch(channels, /"git:/);
  assert.match(prefixes, /"projects:"/, "projects:glance answers before any project is open");
  assert.match(prefixes, /"pc-setup:"/, "so does the account check");
  // Each handler runs through gitCall, which turns a throw into { ok: false } and scrubs credentials from it.
  assert.match(main, /const gitCall = \(run\) => async \(_event, payload\) => \{\s*try \{ return await run\(gitHost\(\), payload && typeof payload === "object" \? payload : \{\}\); \}\s*catch \(error\) \{ return \{ ok: false, error: /);
  assert.equal((main.match(/ipcMain\.handle\("git:[a-z-]+", gitCall\(/g) ?? []).length, 12, "all twelve git:* handlers go through gitCall");
});

test("main.cjs builds the host with exactly the collaborators the factory takes", () => {
  const { createGitHost } = require("../scripts/git-host.cjs");
  const factory = main.slice(main.indexOf("gitHostInstance = createGitHost({"));
  const call = factory.slice(0, factory.indexOf("\n    });"));
  // The keys of the object literal at depth 0: split on commas outside brackets, take each leading name.
  const body = call.slice(call.indexOf("{") + 1);
  const keys = [];
  let depth = 0, current = "";
  for (const char of body) {
    if ("({[".includes(char)) depth += 1;
    if (")}]".includes(char)) depth -= 1;
    if (char === "," && depth === 0) { keys.push(current); current = ""; } else current += char;
  }
  keys.push(current);
  const given = new Set(keys.map((entry) => entry.trim().match(/^([A-Za-z]+)/)?.[1]).filter(Boolean));
  const wanted = ["actions", "link", "context", "listProjects", "syncProject", "projectCheck", "pcSetup", "send", "exists", "now"];
  for (const name of wanted) assert.ok(given.has(name), `main.cjs passes ${name}`);
  assert.equal(typeof createGitHost, "function");
  const declared = require("node:fs").readFileSync(new URL("../scripts/git-host.cjs", import.meta.url), "utf8").match(/function createGitHost\(\{([^}]*)\}/)[1].split(",").map((part) => part.trim().split("=")[0].trim()).filter(Boolean);
  assert.deepEqual([...given].filter((name) => !declared.includes(name)), [], "nothing is passed that the factory ignores");
  assert.match(main, /require\("\.\/scripts\/git-link\.cjs"\)/);
  assert.match(main, /require\("\.\/scripts\/git-actions\.cjs"\)/);
});

test("a project switch resets the chip, choosing a project stamps it, and the launch state carries the facts", () => {
  assert.match(main, /send\("projects:changed", projects\.list\(\)\);\n  if \(typeof gitHostHooks !== "undefined" && gitHostHooks\) gitHostHooks\.onProjectChanged\(\);/);
  assert.match(main, /ipcMain\.handle\("startup:state", async \(\) => \(\{ \.\.\.\(await projectLaunchFacts\(projects\.list\(\)\)\), interactive:/);
  assert.match(main, /startupChosen = true;\n\s+if \(typeof stampProjectOpened === "function"\) void stampProjectOpened\(/);
  assert.match(main, /if \(result\?\.ok !== false && typeof stampProjectOpened === "function"\) void stampProjectOpened\(id\);/);
});

test("the bridge forwards named plain fields, cuts strings, and never names a folder, command or address", async () => {
  const invoked = [], listened = [];
  const page = {
    require: () => ({
      contextBridge: { executeInMainWorld: ({ func, args }) => func(...args) },
      ipcRenderer: { invoke: async (channel, ...args) => { invoked.push([channel, args]); return { ok: true }; }, on: (channel) => listened.push(channel) },
    }),
  };
  vm.runInNewContext(preload, page);
  const api = page.mefiStudio;
  const long = "x".repeat(5000);
  await api.gitState();
  await api.gitState({ projectId: "p0", root: "C:/elsewhere" });
  await api.gitState({ projectId: long, command: "rm -rf" });
  await api.gitCheck({ root: "C:/elsewhere" });
  await api.gitCheck({ projectId: "p5", root: "C:/elsewhere" });
  await api.gitCheck({ projectId: 7 });
  await api.gitPull({ anyway: true, projectId: "p1", root: "C:/elsewhere" });
  await api.gitPull();
  await api.gitPush({ projectId: long, command: "rm -rf" });
  await api.gitRebase({ url: "https://evil" });
  await api.gitSavePreview({ projectId: "p2" });
  await api.gitSave({ paths: ["a.txt", 7, "b/c.txt", null], message: long, push: 1, ignoreBuilders: "yes", projectId: "p3", cwd: "C:/elsewhere" });
  await api.gitOwners();
  await api.gitPublishPreview({ owner: "me", name: "field-notes", gitignore: false, license: "gpl", extra: true });
  await api.gitPublishPreview({ owner: "me", name: "field-notes", projectId: "p6" });
  await api.gitPublish({ owner: "me", name: "field-notes", visibility: "public", description: long, confirmPublic: "me/field-notes", license: "mit", origin: "https://evil" });
  await api.gitPublish({ owner: "me", name: "n", visibility: "everyone" });
  await api.gitPublish({ owner: "me", name: "n", projectId: "p7", origin: "https://evil" });
  await api.gitLinkRepos();
  await api.gitLink("me/repo", { projectId: "p4", url: "https://evil" });
  await api.gitLink(42);
  await api.githubAccount();
  await api.projectsGlance(["a", 5, "b"]);
  await api.projectsGlance();
  const calls = plain(invoked);
  const byChannel = (channel) => calls.filter(([name]) => name === channel).map(([, args]) => args[0]);
  const looks = byChannel("git:state");
  assert.deepEqual(looks.slice(0, 2), [{}, { projectId: "p0" }], "the look names the project when the page does, and never a folder");
  assert.equal(looks[2].projectId.length, 120, "a long id is cut");
  assert.deepEqual(Object.keys(looks[2]), ["projectId"], "a command in the options goes nowhere");
  assert.deepEqual(byChannel("git:check"), [{}, { projectId: "p5" }, {}], "no folder is forwarded; the project is, when the page names one as text");
  assert.deepEqual(byChannel("git:pull"), [{ anyway: true, projectId: "p1" }, { anyway: false }]);
  assert.equal(byChannel("git:push")[0].projectId.length, 120, "an id is cut");
  assert.deepEqual(Object.keys(byChannel("git:push")[0]), ["projectId"], "a command in the options goes nowhere");
  assert.deepEqual(byChannel("git:rebase"), [{}]);
  assert.deepEqual(byChannel("git:save-preview"), [{ projectId: "p2" }]);
  const save = byChannel("git:save")[0];
  assert.deepEqual(save.paths, ["a.txt", "b/c.txt"], "only strings are paths");
  assert.equal(save.message.length, 2000);
  assert.equal(save.push, false, "push is a real boolean, not truthy");
  assert.equal(save.ignoreBuilders, false);
  assert.equal(save.projectId, "p3");
  assert.equal("cwd" in save, false);
  assert.deepEqual(byChannel("git:publish-preview")[0], { owner: "me", name: "field-notes", gitignore: false, license: "none" }, "an unknown license is none");
  assert.deepEqual(byChannel("git:publish-preview")[1], { owner: "me", name: "field-notes", gitignore: true, license: "none", projectId: "p6" }, "the name check carries the project it was opened for");
  const [open, fallback] = byChannel("git:publish");
  assert.equal(open.visibility, "public");
  assert.equal(open.confirmPublic, "me/field-notes");
  assert.equal(open.description.length, 350);
  assert.equal(open.license, "mit");
  assert.equal("origin" in open, false);
  assert.equal(fallback.visibility, "private", "anything but public is private");
  assert.equal(fallback.confirmPublic, "");
  assert.equal("projectId" in open, false, "no id given, no id sent");
  const bound = byChannel("git:publish")[2];
  assert.equal(bound.projectId, "p7", "the publish carries the project it was opened for");
  assert.equal(bound.visibility, "private");
  assert.equal("origin" in bound, false);
  assert.deepEqual(byChannel("git:link"), [{ repo: "me/repo", projectId: "p4" }, { repo: "" }]);
  assert.deepEqual(byChannel("projects:glance"), [{ ids: ["a", "b"] }, {}], "no ids means every project (undefined does not cross the wire)");
  assert.equal(calls.some(([name]) => name === "pc-setup:account"), true);
  page.mefiStudio.onGitState(() => {});
  assert.ok(listened.includes("git:state"), "the chip's model arrives on git:state");
});

// ---- every Git action is bound to the project it was drawn for ---------------------------------
// The page names the project a chip or a dialog was drawn for; preload forwards the id (cut
// to 120 characters, or nothing), main hands the payload to the host, and the host refuses
// an id that no longer matches the open project (tests/git_host.test.mjs). Cut any one link
// and a switch between the look and the press acts on the wrong project.

test("preload forwards the project id on every call that acts on the open project, the look and the check included", () => {
  assert.ok(preload.includes('const gitProject = (options) => (typeof options?.projectId === "string" ? { projectId: options.projectId.slice(0, 120) } : {});'), "one cut, one shape: an id as text or nothing");
  for (const line of [
    'gitState: (options) => ipcRenderer.invoke("git:state", gitProject(options)),',
    'gitCheck: (options) => ipcRenderer.invoke("git:check", gitProject(options)),',
    'gitPull: (options) => ipcRenderer.invoke("git:pull", { anyway: options?.anyway === true, ...gitProject(options) }),',
    'gitPush: (options) => ipcRenderer.invoke("git:push", gitProject(options)),',
    'gitRebase: (options) => ipcRenderer.invoke("git:rebase", gitProject(options)),',
    'gitSavePreview: (options) => ipcRenderer.invoke("git:save-preview", gitProject(options)),',
    'gitLink: (repo, options) => ipcRenderer.invoke("git:link", { repo: gitText(repo, 200), ...gitProject(options) }),',
  ]) assert.ok(preload.includes(line), `preload keeps ${line.slice(0, line.indexOf(":"))} bound`);
  assert.ok(preload.includes("gitignore: options?.gitignore !== false, license: [") && preload.includes("  ...gitProject(options),\n});"), "the name check and the publish share one field list that ends with the project id");
  assert.ok(preload.includes("message: gitText(payload?.message, 2000), push: payload?.push === true, ignoreBuilders: payload?.ignoreBuilders === true, ...gitProject(payload),"), "Save carries it too");
});

const handlerBlock = slice(main, "  const gitCall = (run) => async (_event, payload) => {", "  // ---- Your PCs vault (the");

// The registration lines of main.cjs run against a recording ipcMain and a stand-in host.
function gitHandlers({ host, clock = { now: 1_000_000 }, refreshProcessPath = async () => true } = {}) {
  const handlers = new Map();
  const context = vm.createContext({
    Date: { now: () => clock.now },
    ipcMain: { handle: (channel, fn) => handlers.set(channel, fn) },
    gitHost: () => host,
    refreshProcessPath,
  });
  vm.runInContext(handlerBlock, context);
  return { handlers, call: (channel, payload) => handlers.get(channel)({}, payload) };
}

test("main.cjs hands each git:* payload on to the host, the look and the check included, and an empty object when there is none", async () => {
  const seen = [];
  const host = {};
  const methods = { "git:state": "state", "git:check": "check", "git:pull": "pull", "git:push": "push", "git:rebase": "rebase", "git:save-preview": "savePreview", "git:save": "save", "git:publish-preview": "publishPreview", "git:publish": "publish", "git:link": "link" };
  for (const method of Object.values(methods)) host[method] = (...args) => { seen.push([method, args]); return { ok: true, method }; };
  const h = gitHandlers({ host });
  for (const [channel, method] of Object.entries(methods)) {
    const payload = { projectId: "p1", marker: channel };
    const answer = plain(await h.call(channel, payload));
    assert.deepEqual(answer, { ok: true, method }, `${channel} answers with the host's own answer`);
    const [, args] = seen.at(-1);
    assert.equal(seen.at(-1)[0], method, `${channel} reaches host.${method}`);
    assert.equal(args.length, 1, `${channel} passes exactly the payload`);
    assert.equal(args[0], payload, `${channel} passes the payload it was given, project id and all`);
  }
  seen.length = 0;
  for (const nothing of [undefined, null, "p1", 7]) await h.call("git:state", nothing);
  await h.call("git:check", undefined);
  assert.deepEqual(plain(seen), [["state", [{}]], ["state", [{}]], ["state", [{}]], ["state", [{}]], ["check", [{}]]], "no payload, or one that is not an object, reaches the host as an empty one");
  assert.ok(main.includes('ipcMain.handle("git:state", gitCall((host, payload) => host.state(payload)));'));
  assert.ok(main.includes('ipcMain.handle("git:check", gitCall((host, payload) => host.check(payload)));'));
});

test("the account check reuses an answer for 2.5 s and looks at the registry PATH at most every 20 s", async () => {
  assert.ok(handlerBlock.includes("if (accountNow && Date.now() - accountAt < 2500) return accountNow;"), "an answer is reused for 2500 ms");
  assert.ok(handlerBlock.includes("if (Date.now() - accountPath > 20000) { accountPath = Date.now(); await refreshProcessPath().catch(() => false); }"), "the PATH is read again after 20000 ms, and a failure to read it is not the answer's");

  const start = 1_000_000;
  const setup = (over = {}) => {
    const clock = { now: start };
    const count = { accounts: 0, refreshes: 0 };
    const host = { account: async () => ({ ok: true, account: `me-${++count.accounts}` }) };
    const h = gitHandlers({ host, clock, refreshProcessPath: async () => { count.refreshes += 1; if (over.refuse) throw new Error("registry locked"); return true; } });
    return { clock, count, ask: async () => plain(await h.call("pc-setup:account")) };
  };

  const a = setup();
  const first = await a.ask();
  assert.deepEqual(first, { ok: true, account: "me-1" });
  assert.equal(a.count.refreshes, 1, "the first look reads the PATH before it asks");
  a.clock.now = start + 2499;
  assert.deepEqual(await a.ask(), first, "inside 2.5 s the last answer comes back as it was");
  assert.deepEqual(a.count, { accounts: 1, refreshes: 1 }, "and neither the host nor the PATH was asked");
  a.clock.now = start + 2500;
  assert.equal((await a.ask()).account, "me-2", "at 2.5 s the host is asked again");
  assert.equal(a.count.refreshes, 1, "but the PATH was read only moments ago");
  a.clock.now = start + 20000;
  assert.equal((await a.ask()).account, "me-3");
  assert.equal(a.count.refreshes, 1, "exactly 20 s later it is still not read again");

  const b = setup();
  await b.ask();
  b.clock.now = start + 20001;
  assert.equal((await b.ask()).account, "me-2");
  assert.equal(b.count.refreshes, 2, "one millisecond past 20 s it is");

  const locked = setup({ refuse: true });
  assert.deepEqual(await locked.ask(), { ok: true, account: "me-1" }, "a PATH that cannot be read does not fail the account check");
  assert.equal(locked.count.refreshes, 1);
});
