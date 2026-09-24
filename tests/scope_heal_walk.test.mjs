// Stale file-scope healing walks the project once per root for every missing
// basename, asynchronously, and must answer exactly what the old synchronous
// one-name-per-walk search answered.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import path from "node:path";
import { tmpdir } from "node:os";
import { readdirSync, statSync } from "node:fs";
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";

const source = await readFile(new URL("../main.cjs", import.meta.url), "utf8");
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from + start.length);
  assert.ok(from >= 0 && to > from, `host section exists: ${start}`);
  return source.slice(from, to);
};

// The search as it was: one synchronous breadth-first walk per basename.
const SKIP = new Set(["node_modules", ".git", "dist", "out", "build", "data", "__pycache__", "venv"]);
function previousFind(root, base, { maxEntries = 20000, maxDepth = 6 } = {}) {
  const name = String(base ?? "").trim();
  const start = String(root ?? "").trim();
  if (!name || !start) return null;
  let info;
  try { info = statSync(start, { throwIfNoEntry: false }); } catch { return null; }
  if (!info?.isDirectory()) return null;
  const queue = [[start, 0]];
  let seen = 0;
  let best = null;
  while (queue.length && seen < maxEntries && !best) {
    const [dir, depth] = queue.shift();
    let list;
    try { list = readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const item of list) {
      if (++seen > maxEntries) break;
      if (item.isFile() && item.name === name) { best = path.join(dir, item.name); break; }
      if (item.isDirectory() && depth < maxDepth && !item.name.startsWith(".") && !SKIP.has(item.name.toLowerCase())) queue.push([path.join(dir, item.name), depth + 1]);
    }
  }
  return best;
}

async function tree(t, files) {
  const root = await mkdtemp(path.join(tmpdir(), "studio-scope-walk-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const file of files) {
    await mkdir(path.dirname(path.join(root, file)), { recursive: true });
    await writeFile(path.join(root, file), "x");
  }
  return root;
}

test("one walk per root finds every basename exactly where a walk per name found it", async (t) => {
  const root = await tree(t, [
    "src/a/board.js", "src/b/board.js", "board.js.bak", "lib/deep/er/still/deeper/than/six/levels/lost.lua",
    "lib/one/two/three/four/five/edge.lua", "node_modules/pkg/hidden.js", ".cache/hidden2.js", "Data/skipped.js",
    "tools/test_mefi_studio_eyes.py", "tools/nested/test_mefi_studio_eyes.py", "z/late.txt",
    ...Array.from({ length: 30 }, (_, i) => `bulk/file_${i}.txt`),
  ]);
  const env = vm.createContext({ path, stat, readdir, Map, Set });
  vm.runInContext(section("const SCOPE_WALK_SKIP", "// Pull the handoffs out of one line"), env);
  const names = ["board.js", "lost.lua", "edge.lua", "hidden.js", "hidden2.js", "skipped.js", "test_mefi_studio_eyes.py", "late.txt", "file_29.txt", "absent.md", " board.js ", ""];
  for (const options of [{}, { maxEntries: 12 }, { maxEntries: 25, maxDepth: 2 }, { maxDepth: 0 }]) {
    const found = await env.findBasenamesUnderRoot(root, names, options);
    for (const name of names) {
      assert.equal(found.get(name.trim()) ?? null, previousFind(root, name, options), `${JSON.stringify(name)} with ${JSON.stringify(options)}`);
    }
  }
  assert.equal((await env.findBasenamesUnderRoot(path.join(root, "missing"), ["board.js"])).size, 0);
  assert.equal((await env.findBasenamesUnderRoot(path.join(root, "z", "late.txt"), ["late.txt"])).size, 0, "a file is not a root");
});

test("the heal locator walks each root once, remembers misses, and serves settlement the same way", async (t) => {
  const root = await tree(t, ["src/moved/board.js", "src/panel.js"]);
  const walks = [];
  const env = vm.createContext({
    Map, Set, Date, statSync, projectRoot: () => root,
    findBasenamesUnderRoot: async (walkRoot, bases) => { walks.push([walkRoot, [...bases].sort()]); return new Map([...bases].filter((base) => base === "board.js").map((base) => [base, path.join(root, "src/moved/board.js")])); },
  });
  vm.runInContext(`${section("const SCOPE_HEAL_INTERVAL_MS", "async function healBoardFileScopes(")}\nthis.scopeMisses = scopeMisses;`, env);
  const tasks = [
    { id: "a", files: ["C:/old/src/board.js", path.join(root, "src/panel.js")] },
    { id: "b", file: "C:/old/elsewhere/board.js", files: ["C:/gone/notes.lua"] },
    { files: ["C:/old/ignored/unowned.js"] },
  ];
  const now = 5_000_000;
  const { exists, locate } = await env.staleScopeLocator(tasks, now);
  assert.deepEqual(walks, [[root, ["board.js", "notes.lua"]]], "one walk for every missing name under the root");
  assert.equal(exists(path.join(root, "src/panel.js")), true);
  assert.equal(locate("board.js", tasks[0]), path.join(root, "src/moved/board.js"));
  assert.equal(locate("notes.lua", tasks[1]), null);
  assert.equal(locate("unwalked.js", tasks[1]), null, "a name no walk covered is not found");
  assert.deepEqual([...env.scopeMisses.keys()], [`${root}\nnotes.lua`]);
  walks.length = 0;
  const again = await env.staleScopeLocator([tasks[1]], now + 60_000);
  assert.deepEqual(walks, [[root, ["board.js"]]], "a remembered miss is not walked for again");
  assert.equal(again.locate("notes.lua", tasks[1]), null);
  walks.length = 0;
  await env.staleScopeLocator([tasks[1]], now + 31 * 60_000);
  assert.deepEqual(walks, [[root, ["board.js", "notes.lua"]]], "after 30 minutes the miss is walked for again");
});
