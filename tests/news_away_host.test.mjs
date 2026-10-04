// "Since you were away" in main.cjs (the block of that name): the launch
// screen's band above the news. Run here from main.cjs's own text with the
// host's collaborators stubbed and a real scratch folder for userData and the
// project boards. Pinned: the daily-news switch turns it off with nothing
// read or written, the model baseline is saved once a day with OpenRouter
// read at most once that day, each recent project gets a digest from its
// board, its questions and git (no fetch), and nothing it reads can make it
// throw. The rules themselves are tests/front_page.test.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const main = (await readFile(new URL("../main.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const preload = (await readFile(new URL("../preload.cjs", import.meta.url), "utf8")).replace(/\r\n/g, "\n");
const plain = (value) => JSON.parse(JSON.stringify(value));

function slice(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  assert.ok(from > 0 && to > from, `main.cjs has ${start}`);
  return text.slice(from, to);
}
const block = slice(main, "// ---- The Studio Daily: since you were away", "// ---- end of since you were away");

const CATALOG = {
  models: [{ id: "glm-5.3", name: "GLM-5.3", onRoster: true, releaseDate: "2026-09-30" }],
  providerModels: { claude: [{ id: "claude-opus-5-5", name: "Claude Opus 5.5", releaseDate: "2026-09-22" }], zen: [], zai: [] },
};

async function host({ settings = {}, catalog = CATALOG, openrouter = async () => ({ ok: true, models: [{ id: "a/b", name: "A B" }] }), git = null, signedIn = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "mefi-news-away-"));
  const userData = path.join(root, "userData");
  const projectsDir = path.join(root, "projects");
  mkdirSync(userData, { recursive: true });
  const calls = { openrouter: 0, git: [], chatgpt: 0, logs: [] };
  const list = [];
  const context = vm.createContext({
    require: (name) => {
      if (name === "./scripts/front-page.cjs") return require("../scripts/front-page.cjs");
      if (name === "./scripts/openrouter-catalog.cjs") return { createCatalog: () => async (options) => { calls.openrouter += 1; return openrouter(options); } };
      throw new Error(`unexpected require ${name}`);
    },
    path, existsSync, mkdir, readFile, rename, stat, writeFile, setTimeout, Promise, JSON, Number, String, Array, Object, Math, Date,
    app: { getPath: (name) => { assert.equal(name, "userData"); return userData; } },
    readSettings: async () => settings,
    catalogDocument: { read: async () => { if (catalog instanceof Error) throw catalog; return catalog; } },
    TASKS_PATH: "C:/studio/data/eyes-tasks.json",
    ASSISTANT_PATH: "C:/studio/data/eyes-assistant.json",
    projects: {
      list: () => ({ projects: list }),
      dataPath: (file, project) => path.join(projectsDir, project.id, path.basename(file)),
    },
    projectLaunchFacts: async (value) => value,
    outsideGit: async (folder, args) => {
      calls.git.push(args);
      assert.ok(!args.includes("fetch") && !args.includes("pull"), "no network from git");
      return git ? git(folder, args) : { ok: false, stdout: "" };
    },
    chatgptPlanStatus: async () => ({ signedIn }),
    chatgptPlan: () => ({ listModels: async () => { calls.chatgpt += 1; return { ok: true, models: [{ slug: "gpt-6.1-sol", display_name: "GPT-6.1 Sol" }] }; } }),
    logLine: (line) => calls.logs.push(line),
    process: { pid: 4242 },
  });
  vm.runInContext(`${block}\nthis.api = { newsAway, newsAwayDay };`, context);
  const addProject = (project, { tasks = null, assistant = null, gitFolder = false } = {}) => {
    const folder = path.join(root, "work", project.id);
    mkdirSync(gitFolder ? path.join(folder, ".git") : folder, { recursive: true });
    mkdirSync(path.join(projectsDir, project.id), { recursive: true });
    if (tasks !== null) writeFileSync(path.join(projectsDir, project.id, "eyes-tasks.json"), typeof tasks === "string" ? tasks : JSON.stringify(tasks));
    if (assistant !== null) writeFileSync(path.join(projectsDir, project.id, "eyes-assistant.json"), JSON.stringify(assistant));
    list.push({ path: folder, available: true, ...project });
    return folder;
  };
  return { api: context.api, calls, userData, root, addProject, done: () => rm(root, { recursive: true, force: true }) };
}

test("the daily news switch turns it off: nothing is read or saved", async () => {
  const h = await host({ settings: { ui: { dailyNews: false } } });
  try {
    assert.deepEqual(plain(await h.api.newsAway()), { ok: true, disabled: true });
    assert.equal(h.calls.openrouter, 0);
    assert.equal(existsSync(path.join(h.userData, "news")), false);
  } finally { await h.done(); }
});

test("the band's answer: the models and each recent project's changes, from its board, questions and git", async () => {
  const since = Date.now() - 6 * 3600000;
  const h = await host({
    git: (_folder, args) => args[0] === "log"
      ? { ok: true, stdout: `${Math.floor((since + 60000) / 1000)}\x1fAdd export\n${Math.floor((since + 120000) / 1000)}\x1fFix search\n` }
      : { ok: true, stdout: "2\n" },
  });
  try {
    h.addProject({ id: "p1", name: "Notes app", openedAt: since }, {
      tasks: [{ id: "t1", title: "Pin favourite notes", status: "done", doneAt: since + 1000 }, { id: "t2", title: "Search by tag", status: "running" }],
      assistant: { questions: [{ id: "q1", status: "open", title: "Empty state on search?" }] },
      gitFolder: true,
    });
    h.addProject({ id: "p2", name: "Broken board", openedAt: since - 1000 }, { tasks: "{not json" });
    const answer = plain(await h.api.newsAway());
    assert.equal(answer.ok, true);
    assert.equal(answer.day, h.api.newsAwayDay());
    assert.equal(answer.models.firstVisit, true);
    assert.deepEqual(answer.models.drops.map((drop) => drop.id).sort(), ["claude-opus-5-5", "glm-5.3"].filter((id) => {
      const released = id === "glm-5.3" ? "2026-09-30" : "2026-09-22";
      return Date.parse(`${released}T00:00:00Z`) >= Date.parse(`${answer.day}T00:00:00Z`) - 14 * 86400000;
    }).sort());
    const [notes, broken] = answer.projects;
    assert.equal(notes.name, "Notes app");
    assert.deepEqual(notes.finished.latest.map((task) => task.title), ["Pin favourite notes"]);
    assert.equal(notes.waiting.count, 1);
    assert.equal(notes.running, 1);
    assert.deepEqual(notes.commits, { count: 2, unpulled: 2, latest: [{ subject: "Add export", at: Math.floor((since + 60000) / 1000) * 1000 }, { subject: "Fix search", at: Math.floor((since + 120000) / 1000) * 1000 }] });
    assert.ok(h.calls.git.some((args) => args.includes("HEAD") && args.includes("@{upstream}")), "the branch and its upstream, as the folder has them");
    assert.equal(broken.name, "Broken board");
    assert.equal(broken.quiet, true, "an unreadable board is an empty one, never an error");
    // The day's list is saved, with OpenRouter in it.
    const saved = JSON.parse(await readFile(path.join(h.userData, "news", "models-seen.json"), "utf8"));
    assert.equal(saved.day, answer.day);
    assert.deepEqual(saved.current.openrouter.map((row) => row.id), ["a/b"]);
    assert.equal(h.calls.openrouter, 1);
    // A second look the same day reads OpenRouter from the saved list and says the same.
    const again = plain(await h.api.newsAway());
    assert.deepEqual(again.models, answer.models);
    assert.equal(h.calls.openrouter, 1, "at most once a day");
  } finally { await h.done(); }
});

test("a new day compares with the last list seen; the ChatGPT plan's models count only when signed in", async () => {
  const h = await host({ signedIn: true });
  try {
    const first = plain(await h.api.newsAway());
    assert.equal(h.calls.chatgpt, 1);
    // Yesterday's record, then a new model on the roster today.
    const file = path.join(h.userData, "news", "models-seen.json");
    const saved = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...saved, day: "2000-01-01", baseline: null }));
    CATALOG.models.push({ id: "kimi-k3", name: "Kimi K3", onRoster: true, releaseDate: "2026-10-04" });
    try {
      const next = plain(await h.api.newsAway());
      assert.equal(next.models.firstVisit, false);
      assert.deepEqual(next.models.drops.map((drop) => [drop.source, drop.id]), [["go", "kimi-k3"]]);
      assert.equal(h.calls.openrouter, 2, "a new day reads OpenRouter again");
      assert.equal(h.calls.chatgpt, 2);
    } finally { CATALOG.models.pop(); }
    assert.ok(first.models.drops.every((drop) => drop.source !== "chatgpt" || drop.sourceName === "ChatGPT plan (Codex)"));
  } finally { await h.done(); }
});

test("offline or broken sources leave parts out and never throw", async () => {
  const h = await host({ catalog: new Error("no catalog"), openrouter: async () => { throw new Error("offline"); } });
  try {
    const answer = plain(await h.api.newsAway());
    assert.equal(answer.ok, true);
    assert.deepEqual(answer.models.drops, []);
    assert.deepEqual(answer.projects, []);
    const saved = JSON.parse(await readFile(path.join(h.userData, "news", "models-seen.json"), "utf8"));
    assert.equal("openrouter" in saved.current, false, "OpenRouter is left out today, not saved as empty");
  } finally { await h.done(); }
});

test("the block is inert when it loads, the handler is app-wide, and the bridge forwards nothing", () => {
  assert.ok(!/^\s*(?:ipcMain|app\.on|setInterval)/m.test(block), "nothing runs when main.cjs loads the block");
  assert.match(main, /ipcMain\.handle\("news:away", \(\) => \(typeof newsAway === "function" \? newsAway\(\) : \{ ok: false, error: "unavailable" \}\)\);/);
  assert.match(main, /const APP_WIDE_PREFIXES = \[[^\]]*"news:"/, "asked before any project is open");
  assert.match(preload, /newsAway: \(\) => ipcRenderer\.invoke\("news:away"\),/);
});
