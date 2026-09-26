"""Live-update contracts for Mefi's Studio AI+ (standalone repository).

Feeds fixture directories through the real scripts/updater.mjs: the
reload/restart/ignore classify table, snapshot + diff, payload sync that never
touches data/ and holds (instead of half-updating) when one destination is
locked, syntax validation that holds a broken file and reads renderer scripts
with the booklet's classic-script goal, the quiet-period debounce that
coalesces a burst into one action, manual apply when auto is off (also when it
lands mid-run), the restart-loop guard and the packaged runtime guard. Runs
main.cjs's own applyRestart / update:apply against the engine so a manual
restart never feeds the loop guard. Also builds the booklet into a temp root
through the exported build({ root }) and pins the wiring: IPC channels, preload
names, template ids, the SMOKE/CAPTURE/CLI skip and the --updated relaunch flag.
The idle safety-net poll is pinned too: it pauses while the window is hidden
(the host's `hidden` probe), backs off on unchanged reads toward POLL_MAX_MS,
and snaps back on any activity or change so a change made while hidden still
applies on the first visible walk — no stale UI; renderer/overhead.js's sheet
poll carries the same pause/backoff shape, with the window export pinned only
to its consumer surface (open/close) rather than a verbatim member list.
No Electron, no network; the Node half skips cleanly without Node.
"""
from pathlib import Path
import json
import re
import shutil
import subprocess
import tempfile
import unittest

try:
    from flake_capture import retry_transient
except ImportError:  # imported as tools.test_mefi_studio_updater
    from .flake_capture import retry_transient


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
UPDATER = STUDIO / "scripts" / "updater.mjs"
BUILD = STUDIO / "scripts" / "build-booklet.mjs"
NODE = shutil.which("node")


def read_text(path):
    # utf-8-sig strips a UTF-8 BOM if a concurrent PowerShell rewrite left
    # one behind, and decodes BOM-less files identically.
    return path.read_text(encoding="utf-8-sig") if path.is_file() else ""


class MefiStudioUpdaterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = read_text(STUDIO / "main.cjs")
        cls.preload = read_text(STUDIO / "preload.cjs")
        cls.template = read_text(STUDIO / "renderer" / "booklet.template.html")
        cls.nav = read_text(STUDIO / "renderer" / "nav.js")
        cls.booklet_js = read_text(STUDIO / "renderer" / "booklet.js")
        cls.build = read_text(BUILD)
        cls.updater = read_text(UPDATER)
        cls.overhead = read_text(STUDIO / "renderer" / "overhead.js")
        cls.package = json.loads(read_text(STUDIO / "package.json") or "{}")
        cls.architecture = read_text(STUDIO / "docs" / "architecture.md")
        cls.readme = read_text(STUDIO / "README.md")
        cls.guide = read_text(ROOT / "TESTRUNS.md")

    def run_module(self, script, **paths):
        """Runs an ESM script on stdin; UPDATER/BUILD and any extra keys are substituted as JSON strings."""
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        replacements = {"UPDATER_URL": UPDATER.as_uri(), "BUILD_URL": BUILD.as_uri(), **{key: str(value) for key, value in paths.items()}}
        for key, value in replacements.items():
            script = script.replace(f"__{key}__", json.dumps(value))
        result = subprocess.run([NODE, "--input-type=module", "-"], input=script, cwd=STUDIO, capture_output=True, text=True, timeout=120)
        self.assertEqual(0, result.returncode, result.stderr)
        return json.loads(result.stdout.strip().splitlines()[-1])

    # ---- static wiring ---------------------------------------------------
    def test_ipc_preload_and_template_wiring(self):
        for channel in ('ipcMain.handle("update:status"', 'ipcMain.handle("update:set"', 'ipcMain.handle("update:apply"', 'send("update:event"'):
            with self.subTest(channel=channel):
                self.assertIn(channel, self.main)
        for name in ("updateStatus", "updateSet", "updateApply", "onUpdateEvent", 'ipcRenderer.on("update:event"'):
            with self.subTest(name=name):
                self.assertIn(name, self.preload)
        for element_id in ("update-pill", "update-auto", "update-apply", "update-status"):
            with self.subTest(element_id=element_id):
                self.assertIn(f'id="{element_id}"', self.template)

    def test_watch_skips_headless_modes_and_stops_on_close(self):
        self.assertRegex(self.main, r"if \(!SMOKE && !CAPTURE && !CLI_MODE\)[^\n]*startUpdateWatch\(")
        self.assertIn("async function startUpdateWatch()", self.main)
        self.assertIn("function stopUpdateWatch()", self.main)
        closing = self.main[self.main.index('app.on("window-all-closed"'):]
        self.assertIn("stopUpdateWatch();", closing[:400])
        self.assertIn('"scripts", "updater.mjs"', self.main)
        self.assertIn("const UPDATE_SOURCE_ROOT = SOURCE_ROOT;", self.main)

    def test_restart_relaunches_with_updated_flag(self):
        for marker in (
            'process.argv.includes("--updated")',
            '!arg.startsWith("--updated")',
            'args.push("--updated")',
            "app.relaunch({ args: relaunchArgs() })",
            "app.releaseSingleInstanceLock()",
            "app.exit(0)",
            "reloadIgnoringCache()",
            "flushStorageData()",
            "settings.update",
            "lastRestart",
            "restarts",
            "deferred: true",
            'phase: "restarted"',
            'phase: "reloaded"',
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.main)

    def test_manual_restart_and_a_queued_apply_are_kept_apart(self):
        """Runs main.cjs's own applyRestart and update:apply handler (lifted from the file) against the real engine."""
        for marker in (
            "async function applyRestart(files, { counted = true } = {})",
            "applyRestart([], { counted: false })",
            "!result.queued",
            # A restart taskkills the executor's `opencode run` children, and the
            # agents edit main.cjs — without this the loop restarted itself every
            # ~20 s and killed the very jobs it had just started.
            "autopilot.jobs.length",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.main)
        script = self.FIXTURE + """
const main = (await readFile(__MAIN__, "utf8")).replace(/\\r\\n/g, "\\n");
const cut = (from, to) => {
  const start = main.indexOf(from);
  const end = main.indexOf(to, start);
  if (start < 0 || end < 0) throw new Error(`main.cjs no longer has ${from}`);
  return main.slice(start, end);
};
const restartSource = cut("async function applyRestart(", "\\nasync function startUpdateWatch(");
const applySource = `${cut('ipcMain.handle("update:apply"', "\\n  });\\n")}\\n  });`;
// Everything main.cjs reaches for is a stub on one scope object, so the
// lifted code sees the current updater / LOVE child at call time.
let stored = { update: { auto: true, restarts: [Date.now() - 120000] } };
const exits = [];
const handlers = {};
const scope = {
  updater: null,
  activeChild: null,
  // A restart kills every `opencode run` the executor spawned, so applyRestart
  // defers while any is in flight. No jobs here: these cases are about the
  // manual-vs-queued restart paths, not the executor.
  autopilot: { jobs: [] },
  projectSwitching: false,
  updateDrainRequested: false,
  window: null,
  UPDATE_GRACE_MS: 0,
  readSettings: async () => JSON.parse(JSON.stringify(stored)),
  writeSettings: async (next) => { stored = JSON.parse(JSON.stringify(next)); },
  settingsDisk: { queue: Promise.resolve() },
  saveResume: async () => {},
  stopUpdateWatch: () => {},
  stopEyesWatch: () => {},
  stopMachineWatch: () => {},
  stopAssistant: () => {},
  relaunchArgs: () => ["--updated"],
  app: { releaseSingleInstanceLock: () => {}, relaunch: () => {}, exit: (code) => exits.push(code) },
  ipcMain: { handle: (channel, handler) => { handlers[channel] = handler; } },
};
const bind = (body) => new Function("scope", `with (scope) { ${body} }`)(scope);
scope.applyRestart = bind(`return (${restartSource.replace("async function applyRestart(", "async function (")});`);
// Settings saves ride main's queue, lifted the same way.
scope.updateSettings = bind(`return (${cut("function updateSettings(", "\\nfunction send(channel, payload)")});`);
bind(applySource);
const apply = handlers["update:apply"];
const viaMain = { restart: (files) => scope.applyRestart(files) };
await seed(root);

// 1. An apply that lands mid-run is queued; it must not relaunch the app.
let release;
let gate = new Promise((resolve) => { release = resolve; });
let reachedBuild;
const atBuild = new Promise((resolve) => { reachedBuild = resolve; });
scope.updater = make({
  build: async () => { calls.build += 1; if (gate) { const waiting = gate; gate = null; reachedBuild(); await waiting; } return {}; },
  actions: { reload: async (files) => { calls.reload.push(files); }, ...viaMain },
});
await scope.updater.start();
await put(root, "renderer/a.js", "const a = 1;\\n");
const first = scope.updater.applyNow();
await atBuild;
const queued = await apply();
const exitsWhileQueued = exits.length;
release();
await first;
await scope.updater.whenIdle();

// 2. Nothing pending: three manual "Restart now" presses inside a minute.
const manual = [];
for (let press = 0; press < 3; press += 1) manual.push(await apply());
const afterManual = { exits: exits.length, restarts: [...stored.update.restarts], last: stored.update.lastRestart };

// 3. The next boot seeds the loop guard from settings, as startUpdateWatch does,
// and a genuine restart-class change still applies.
scope.updater.stop();
const bootAt = Date.now();
scope.updater = make({ restartHistory: (stored.update.restarts ?? []).filter((stamp) => bootAt - stamp < 60000), actions: viaMain });
await scope.updater.start();
await put(root, "main.cjs", "// main 1\\n");
scope.updater.notify("main.cjs");
await scope.updater.whenIdle();
const real = { phase: scope.updater.status().phase, exits: exits.length, restarts: stored.update.restarts.length, last: stored.update.lastRestart };

// 4. LOVE running: the manual restart is deferred, not forced.
scope.activeChild = { exitCode: null };
const deferred = await apply();
scope.activeChild = null;

// 5. A held update is not "nothing pending" either.
await put(root, "renderer/b.js", "const = ;\\n");
const held = await apply();
scope.updater.stop();
console.log(JSON.stringify({ queued, exitsWhileQueued, reloads: calls.reload.map((files) => [...files]), manual, afterManual, real, deferred, held, finalExits: exits.length }));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory), MAIN=STUDIO / "main.cjs")
        self.assertTrue(payload["queued"]["queued"], payload["queued"])
        self.assertEqual(0, payload["exitsWhileQueued"], "an apply queued behind a run in flight never relaunches the app")
        self.assertEqual([["renderer/a.js"]], payload["reloads"], "the run the queued apply joined still reloads")
        self.assertEqual(3, payload["afterManual"]["exits"], "with nothing pending the button is a manual restart")
        for reply in payload["manual"]:
            self.assertTrue(reply["ok"], reply)
        self.assertEqual([], payload["afterManual"]["restarts"], "manual restarts stay out of the loop history, and stale stamps are dropped")
        self.assertEqual([], payload["afterManual"]["last"]["files"])
        self.assertEqual("watching", payload["real"]["phase"], "three manual restarts do not make the next real update hold as a restart loop")
        self.assertEqual(4, payload["real"]["exits"])
        self.assertEqual(1, payload["real"]["restarts"], "a restart the updater asked for is counted")
        self.assertEqual(["main.cjs"], payload["real"]["last"]["files"])
        self.assertFalse(payload["deferred"]["ok"])
        self.assertEqual("Love2D is running", payload["deferred"]["error"])
        self.assertEqual("held", payload["held"]["phase"])
        self.assertEqual(4, payload["finalExits"], "neither a deferred nor a held apply relaunches")

    def test_build_exports_build_and_keeps_cli_and_auditor_literals(self):
        self.assertIn("export async function build({ root = ROOT } = {})", self.build)
        self.assertIn('const RENDERER = path.join(root, "renderer");', self.build)
        self.assertIn("path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)", self.build)
        for name in ("task-groups.js", "file-inputs.js", "nav.js", "sidebar.js", "styles.css", "model-lab.js", "idle.js", "booklet.js"):
            with self.subTest(name=name):
                self.assertIn(f'readFile(path.join(RENDERER, "{name}")', self.build)
        self.assertIn("[stageLabels, nodeVisuals, performanceCore, profiler, taskGroups, studioUi, fileInputs, nav, sidebar, graph, modelLab, tracker, nodeStyles, tree, treeDynamics, idle,", self.build)
        self.assertNotIn('from "electron"', self.updater)
        self.assertNotIn('require("electron")', self.updater)
        check = self.package.get("scripts", {}).get("check", "")
        # The chain's syntax pass (scripts/check-syntax.mjs) discovers every
        # scripts/*.mjs and renderer/*.js on disk instead of naming each file.
        self.assertIn("node scripts/check-syntax.mjs", check)
        if NODE is None:
            self.skipTest("Node unavailable; static contracts still ran")
        listing = subprocess.run(
            [NODE, "-e", "import(require('node:url').pathToFileURL(require('node:path').resolve('scripts/check-syntax.mjs')).href).then((m) => console.log(JSON.stringify(m.discoverTargets(process.cwd()))))"],
            cwd=STUDIO,
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=60,
        )
        self.assertEqual(0, listing.returncode, listing.stdout + listing.stderr)
        discovered = json.loads(listing.stdout.strip().splitlines()[-1])
        self.assertIn("scripts/updater.mjs", discovered)
        self.assertIn("renderer/nav.js", discovered)
        self.assertEqual(1, discovered.count("renderer/palette.js"))

    def test_renderer_wiring_and_resume_contract(self):
        for marker in ("mefiStudio.resume", "onUpdateEvent", "updateStatus", "updateApply", "updateSet", "Toggle automatic updates", "Apply update now", "#update-pill"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.nav)
        self.assertIn("MefiNav?.resume?.()", self.booklet_js)
        self.assertNotIn('getElementById("update-', self.nav, "nav.js looks the update ids up with querySelector (spec 2.1)")
        # In-place updates: the stylesheet slot the host swaps, the pause gate's
        # activity probe, and the full-state resume (fields, scroll, focus, the
        # Command view's selection and the sheets' own selections).
        self.assertIn('<style id="booklet-styles">__BOOKLET_STYLES__</style>', self.template)
        for marker in ("applyStyles", "activity", "fields", "scroll", "focus", "MefiIdle?.saveState", "MefiExplorer?.saveState", "MefiTasks?.saveState", '"waiting"', '"styled"', '"swapped"', "Updated in place"):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.nav)
        self.assertIn("Apply updates automatically", self.template)

    def test_docs_register_this_contract(self):
        self.assertIn("`tools/test_mefi_studio_updater.py`", self.guide)
        self.assertIn("## Live update", self.architecture)

    # ---- real engine on fixtures -------------------------------------------
    def test_classify_table(self):
        table = {
            "renderer/nav.js": "reload",
            "renderer\\idle.js": "reload",
            "renderer/styles.css": "style",
            "renderer/booklet.template.html": "reload",
            "scripts/build-booklet.mjs": "reload",
            "main.cjs": "restart",
            "scripts/paths.cjs": "restart",
            "preload.cjs": "reload",
            "package.json": "sync",
            "scripts/updater.mjs": "modules",
            "scripts/deep/tool.mjs": "modules",
            "scripts/notes.txt": "sync",
            "assets/icon.ico": "sync",
            "renderer/booklet.html": "ignore",
            "renderer/booklet.html.tmp": "ignore",
            "renderer/sub/extra.js": "ignore",
            "data/eyes-tasks.json": "ignore",
            "dist/Mefi Studio AI+/resources/app/main.cjs": "ignore",
            "node_modules/electron/index.js": "ignore",
            ".gitignore": "ignore",
            "scripts/.cache/x.mjs": "ignore",
            "scripts/eyes.mjs~": "ignore",
            "scripts/eyes.mjs.tmp": "ignore",
            "scripts/eyes.mjs.tmp.4312.1700000000": "ignore",
            "scripts/.eyes.mjs.swp": "ignore",
            "scripts/eyes.mjs.crswap": "ignore",
            "scripts/eyes.mjs.bak": "ignore",
            "renderer/nav.js.sync-tmp": "ignore",
            "assets/icon.ico.sync-tmp": "ignore",
            "README.md": "ignore",
            "package-lock.json": "ignore",
            "../outside.js": "ignore",
            "": "ignore",
        }
        script = """
import { classify, classifyPath, plan, KINDS } from __UPDATER_URL__;
const paths = JSON.parse(__PATHS__);
console.log(JSON.stringify({
  each: Object.fromEntries(paths.map((rel) => [rel, classifyPath(rel)])),
  kinds: KINDS,
  none: classify(["data/eyes-tasks.json", "renderer/booklet.html", "README.md"]),
  empty: classify([]),
  style: classify(["data/x.json", "renderer/styles.css"]),
  reloadWins: classify(["renderer/nav.js", "scripts/eyes.mjs", "renderer/styles.css"]),
  restartWins: classify(["renderer/nav.js", "scripts/eyes.mjs", "main.cjs"]),
  mixed: plan(["renderer/nav.js", "scripts/eyes.mjs", "renderer\\styles.css", "scripts/eyes.mjs", "assets/icon.ico"]),
  styleOnly: plan(["renderer/styles.css"]),
  modulesOnly: plan(["scripts/eyes.mjs", "scripts/deep/tool.mjs", "package.json"]),
  restart: plan(["main.cjs", "scripts/eyes.mjs", "renderer/styles.css"]),
  syncOnly: plan(["assets/icon.ico"]),
  nothing: plan(["data/x.json"]),
}));
"""
        payload = self.run_module(script, PATHS=json.dumps(list(table)))
        for rel, expected in table.items():
            with self.subTest(path=rel):
                self.assertEqual(expected, payload["each"][rel])
        self.assertEqual(["none", "sync", "style", "modules", "reload", "restart"], payload["kinds"], "weakest first: the label of a change set is its strongest kind")
        self.assertEqual("none", payload["none"])
        self.assertEqual("none", payload["empty"])
        self.assertEqual("style", payload["style"], "a stylesheet edit is applied in place, not by a reload")
        self.assertEqual("reload", payload["reloadWins"], "a renderer script edit needs the page reload; the module swap rides along")
        self.assertEqual("restart", payload["restartWins"], "only main.cjs still restarts the app")
        mixed = payload["mixed"]
        self.assertEqual({"kind": "reload", "restart": False, "reload": True, "style": False, "modules": ["scripts/eyes.mjs"], "sync": True, "build": True}, mixed, "the reload covers the stylesheet; modules are listed once")
        self.assertEqual({"kind": "style", "restart": False, "reload": False, "style": True, "modules": [], "sync": True, "build": True}, payload["styleOnly"])
        self.assertEqual({"kind": "modules", "restart": False, "reload": False, "style": False, "modules": ["scripts/eyes.mjs", "scripts/deep/tool.mjs"], "sync": True, "build": False}, payload["modulesOnly"], "script-only edits swap in process and never touch the page")
        self.assertEqual({"kind": "restart", "restart": True, "reload": False, "style": False, "modules": [], "sync": True, "build": True}, payload["restart"], "a restart reloads everything, so nothing else is planned beside it")
        self.assertEqual({"kind": "sync", "restart": False, "reload": False, "style": False, "modules": [], "sync": True, "build": False}, payload["syncOnly"])
        self.assertEqual({"kind": "none", "restart": False, "reload": False, "style": False, "modules": [], "sync": False, "build": False}, payload["nothing"])

    def test_snapshot_and_diff_fixture(self):
        script = """
import { snapshot, diff } from __UPDATER_URL__;
import { mkdir, writeFile, rm, utimes } from "node:fs/promises";
import path from "node:path";
const root = __ROOT__;
const put = async (rel, text) => { await mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await writeFile(path.join(root, rel), text); };
await put("main.cjs", "// main\\n");
await put("preload.cjs", "// preload\\n");
await put("package.json", JSON.stringify({ name: "x", main: "main.cjs", scripts: { check: "a" } }));
await put("renderer/a.js", "const a = 1;\\n");
await put("renderer/same.js", "const same = 1;\\n");
await put("renderer/booklet.html", "<html>generated</html>");
await put("scripts/sub/tool.mjs", "export const tool = 1;\\n");
await put("data/eyes-tasks.json", "[]");
await put(".hidden/x.js", "1");
const before = await snapshot(root, { hash: true });
const beforeStat = await snapshot(root);
await put("renderer/a.js", "const a = 2222;\\n");
await put("scripts/new.mjs", "export const fresh = 1;\\n");
await rm(path.join(root, "preload.cjs"));
await put("renderer/booklet.html", "<html>rebuilt and longer</html>");
await put("data/eyes-tasks.json", "[1,2,3]");
await put("package.json", JSON.stringify({ name: "x", main: "main.cjs", scripts: { check: "a && b" } }));
const later = new Date(Date.now() + 5000);
await utimes(path.join(root, "renderer/same.js"), later, later);
const after = await snapshot(root, { hash: true });
const afterStat = await snapshot(root);
console.log(JSON.stringify({ keys: Object.keys(before), hashed: diff(before, after), stat: diff(beforeStat, afterStat), entry: before["renderer/a.js"] }));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory))
        self.assertEqual(
            ["main.cjs", "package.json", "preload.cjs", "renderer/a.js", "renderer/same.js", "scripts/sub/tool.mjs"],
            payload["keys"],
            "generated booklet, data/ and dot-directories stay out of the watched set",
        )
        self.assertEqual(["renderer/a.js"], payload["hashed"]["changed"], "same-content touch and scripts-only package.json edits are not updates")
        self.assertEqual(["scripts/new.mjs"], payload["hashed"]["added"])
        self.assertEqual(["preload.cjs"], payload["hashed"]["removed"])
        self.assertEqual(["preload.cjs", "renderer/a.js", "scripts/new.mjs"], payload["hashed"]["all"])
        self.assertIn("renderer/same.js", payload["stat"]["changed"], "the cheap stat poll still notices the touch")
        self.assertIn("package.json", payload["stat"]["changed"])
        self.assertEqual({"mtimeMs", "size", "sha1"}, set(payload["entry"]))

    def test_sync_payload_never_touches_data(self):
        script = """
import { syncPayload } from __UPDATER_URL__;
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
const base = __ROOT__;
const source = path.join(base, "repo", "mefi-studio");
const app = path.join(base, "dist", "resources", "app");
const put = async (root, rel, text) => { await mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await writeFile(path.join(root, rel), text); };
await put(source, "renderer/a.js", "NEW");
await put(source, "renderer/booklet.html", "BUILT");
await put(source, "scripts/deep/new.mjs", "DEEP");
await put(source, "data/eyes-tasks.json", "SOURCE-STATE");
await put(source, "package.json", JSON.stringify({ name: "mefi-studio", productName: "P", version: "0.1.0", description: "d", main: "main.cjs", type: "module", scripts: { start: "electron ." }, devDependencies: { electron: "44.4.1" } }));
await put(app, "renderer/a.js", "OLD");
await put(app, "scripts/gone.mjs", "STALE");
await put(app, "data/eyes-tasks.json", "LIVE-USER-STATE");
const result = await syncPayload({ sourceRoot: source, appRoot: app, relPaths: ["renderer/a.js", "renderer\\\\booklet.html", "scripts/deep/new.mjs", "scripts/gone.mjs", "data/eyes-tasks.json", "data", "../escape.js", "package.json", "main.cjs"] });
const same = await syncPayload({ sourceRoot: source, appRoot: source, relPaths: ["renderer/a.js"] });
console.log(JSON.stringify({
  result, same,
  a: await readFile(path.join(app, "renderer/a.js"), "utf8"),
  booklet: await readFile(path.join(app, "renderer/booklet.html"), "utf8"),
  deep: await readFile(path.join(app, "scripts/deep/new.mjs"), "utf8"),
  data: await readFile(path.join(app, "data/eyes-tasks.json"), "utf8"),
  gone: existsSync(path.join(app, "scripts/gone.mjs")),
  escaped: existsSync(path.join(base, "dist", "resources", "escape.js")),
  pkg: JSON.parse(await readFile(path.join(app, "package.json"), "utf8")),
  leftovers: (await readdir(path.join(app, "renderer"))).filter((name) => name.endsWith(".sync-tmp")),
}));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory))
        self.assertEqual("NEW", payload["a"])
        self.assertEqual("BUILT", payload["booklet"])
        self.assertEqual("DEEP", payload["deep"])
        self.assertEqual("LIVE-USER-STATE", payload["data"], "payload data/ holds live user state and is never overwritten")
        self.assertFalse(payload["gone"], "files removed from the source are removed from the payload")
        self.assertFalse(payload["escaped"])
        self.assertEqual(["package.json", "renderer/a.js", "renderer/booklet.html", "scripts/deep/new.mjs"], payload["result"]["copied"])
        self.assertEqual(["scripts/gone.mjs"], payload["result"]["deleted"])
        self.assertEqual(["../escape.js", "data", "data/eyes-tasks.json", "main.cjs"], payload["result"]["skipped"], "a missing core file is never deleted from the payload")
        self.assertEqual([], payload["result"]["failed"])
        self.assertEqual(["description", "main", "name", "productName", "version"], sorted(payload["pkg"]))
        self.assertEqual([], payload["leftovers"])
        self.assertEqual({"copied": [], "deleted": [], "skipped": [], "failed": []}, payload["same"], "dev mode (sourceRoot === appRoot) is a no-op")

    def test_sync_reports_a_locked_destination_instead_of_aborting(self):
        script = """
import { syncPayload } from __UPDATER_URL__;
import { mkdir, writeFile, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
const base = __ROOT__;
const source = path.join(base, "repo", "mefi-studio");
const app = path.join(base, "dist", "resources", "app");
const put = async (root, rel, text) => { await mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await writeFile(path.join(root, rel), text); };
const files = ["assets/icon.ico", "main.cjs", "preload.cjs", "renderer/nav.js", "scripts/eyes.mjs"];
for (const rel of files) { await put(source, rel, `NEW ${rel}`); await put(app, rel, `OLD ${rel}`); }
// An unreplaceable destination: neither rename nor copyFile can land on a
// non-empty directory, which is what a locked/AV-held file looks like.
await rm(path.join(app, "assets/icon.ico"), { force: true });
await put(app, "assets/icon.ico/inner.txt", "locked");
const result = await syncPayload({ sourceRoot: source, appRoot: app, relPaths: files });
const after = {};
for (const rel of ["main.cjs", "preload.cjs", "renderer/nav.js", "scripts/eyes.mjs"]) after[rel] = await readFile(path.join(app, rel), "utf8");
console.log(JSON.stringify({ result, after, leftovers: (await readdir(path.join(app, "assets"))).filter((name) => name.includes(".sync-tmp")) }));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory))
        self.assertEqual(
            ["main.cjs", "preload.cjs", "renderer/nav.js", "scripts/eyes.mjs"],
            payload["result"]["copied"],
            "one unreplaceable destination does not abort the files after it",
        )
        self.assertEqual(["assets/icon.ico"], [entry["rel"] for entry in payload["result"]["failed"]])
        self.assertTrue(payload["result"]["failed"][0]["error"], "the failure carries the OS error")
        self.assertEqual("NEW main.cjs", payload["after"]["main.cjs"])
        self.assertEqual("NEW scripts/eyes.mjs", payload["after"]["scripts/eyes.mjs"])
        self.assertEqual([], payload["leftovers"], "no .sync-tmp is left behind when the replace fails")

    def test_validate_holds_a_syntax_error(self):
        script = """
import { validate } from __UPDATER_URL__;
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = __ROOT__;
const put = async (rel, text) => { await mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await writeFile(path.join(root, rel), text); };
await put("renderer/good.js", '(function () { "use strict"; window.ok = true; })();\\n');
await put("renderer/bad.js", "(function () {\\n  const = ;\\n})();\\n");
await put("main.cjs", 'const path = require("node:path");\\n');
await put("scripts/tool.mjs", "export const tool = 1;\\n");
await put("renderer/booklet.template.html", "<style>__BOOKLET_STYLES__</style><script>__BOOKLET_CODE__</script>");
const good = await validate(root, ["renderer/good.js", "main.cjs", "scripts/tool.mjs", "renderer/styles.css"], { execPath: process.execPath });
const bad = await validate(root, ["renderer/bad.js", "renderer/booklet.template.html", "preload.cjs", "data/x.js"], { execPath: process.execPath });
const missing = await validate(root, ["main.cjs"], { execPath: path.join(root, "no-such-runtime.exe") });
await put("package.json", "{ not json");
const manifest = await validate(root, ["package.json"], { execPath: process.execPath });
console.log(JSON.stringify({ good, bad, missing, manifest }));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory))
        self.assertTrue(payload["good"]["ok"], payload["good"])
        self.assertEqual(3, payload["good"]["checked"], "a removed non-core file is skipped, not an error")
        self.assertFalse(payload["bad"]["ok"])
        by_file = {error["file"]: error["message"] for error in payload["bad"]["errors"]}
        self.assertEqual({"renderer/bad.js", "renderer/booklet.template.html", "preload.cjs"}, set(by_file))
        self.assertIn("SyntaxError", by_file["renderer/bad.js"])
        self.assertIn("line 2", by_file["renderer/bad.js"])
        self.assertIn("__BOOKLET_DATA__", by_file["renderer/booklet.template.html"])
        self.assertEqual("core file missing", by_file["preload.cjs"])
        self.assertFalse(payload["missing"]["ok"], "an unavailable validator holds the update instead of waving it through")
        self.assertIn("validator unavailable", payload["missing"]["errors"][0]["message"])
        self.assertFalse(payload["manifest"]["ok"])
        self.assertEqual("package.json", payload["manifest"]["errors"][0]["file"])
        self.assertIn("JSON does not parse", payload["manifest"]["errors"][0]["message"])

    def test_validate_reads_renderer_scripts_the_way_the_booklet_runs_them(self):
        """build-booklet joins renderer/*.js into one classic <script>; the gate must use that parse goal."""
        script = """
import { validate } from __UPDATER_URL__;
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
const root = __ROOT__;
const put = async (rel, text) => { await mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await writeFile(path.join(root, rel), text); };
// The real manifest is "type": "module", which is what made `node --check`
// read renderer/*.js as ES modules.
await put("package.json", JSON.stringify({ name: "fixture", type: "module", main: "main.cjs" }));
await put("renderer/tla.js", "const data = await Promise.resolve(42);\\n");
await put("renderer/esm.js", "export const value = 1;\\n");
await put("renderer/imp.js", 'import thing from "./thing.js";\\n');
await put("renderer/sloppy.js", "const bag = { a: 1 };\\nwith (bag) { window.a = a; }\\n");
await put("scripts/tla.mjs", "const data = await Promise.resolve(42);\\nexport { data };\\n");
const verdicts = {};
for (const rel of ["renderer/tla.js", "renderer/esm.js", "renderer/imp.js", "renderer/sloppy.js", "scripts/tla.mjs"]) {
  verdicts[rel] = await validate(root, [rel], { execPath: process.execPath });
}
console.log(JSON.stringify(verdicts));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory))
        for rel, fragment in (
            ("renderer/tla.js", "await is only valid"),
            ("renderer/esm.js", "Unexpected token 'export'"),
            ("renderer/imp.js", "Cannot use import statement"),
        ):
            with self.subTest(path=rel):
                self.assertFalse(payload[rel]["ok"], f"{rel} breaks the booklet's one script block and must be held")
                self.assertEqual(rel, payload[rel]["errors"][0]["file"])
                self.assertIn(fragment, payload[rel]["errors"][0]["message"])
                self.assertIn("line 1", payload[rel]["errors"][0]["message"])
        self.assertTrue(payload["renderer/sloppy.js"]["ok"], "the booklet's script block is sloppy mode, so the gate must not hold sloppy-only code")
        self.assertTrue(payload["scripts/tla.mjs"]["ok"], "scripts/**.mjs really are ES modules and keep the module goal")

    FIXTURE = """
import { createUpdater } from __UPDATER_URL__;
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
const root = __ROOT__;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const put = async (base, rel, text) => { await mkdir(path.dirname(path.join(base, rel)), { recursive: true }); await writeFile(path.join(base, rel), text); };
const seed = async (base) => {
  await put(base, "main.cjs", "// main 0\\n");
  await put(base, "preload.cjs", "// preload\\n");
  await put(base, "package.json", JSON.stringify({ name: "fixture", main: "main.cjs", devDependencies: { electron: "99.0.0" } }));
  await put(base, "renderer/a.js", "const a = 0;\\n");
  await put(base, "renderer/b.js", "const b = 0;\\n");
  await put(base, "renderer/booklet.template.html", "__BOOKLET_DATA__ __BOOKLET_STYLES__ __BOOKLET_CODE__");
  await put(base, "scripts/updater.mjs", "export {};\\n");
  await put(base, "scripts/build-booklet.mjs", "export async function build() { return {}; }\\n");
};
const calls = { reload: [], restart: [], build: 0 };
const events = [];
const make = (options = {}) => createUpdater({
  sourceRoot: root, appRoot: root, watch: false, pollMs: 3600000, debounceMs: 200, restartQuietMs: 200, maxWaitMs: 5000,
  execPath: process.execPath,
  build: async () => { calls.build += 1; return {}; },
  actions: { reload: async (files) => { calls.reload.push(files); }, restart: async (files) => { calls.restart.push(files); } },
  onEvent: (payload) => events.push(payload),
  ...options,
});
"""

    def _debounce_probe(self):
        script = self.FIXTURE + """
await seed(root);
// The burst outlasts the quiet period twice over, so only a timer that restarts
// on every notify stays silent through it. The six versions are written before
// the timed loop: a slow filesystem write inside it would end the quiet period
// and split the burst, which measures the machine rather than the debounce.
const quietMs = 1200;
const updater = make({ debounceMs: quietMs });
await updater.start();
for (let index = 1; index <= 6; index += 1) {
  await put(root, index % 2 ? "renderer/a.js" : "renderer/b.js", `const v = ${"1".repeat(index)};\\n`);
}
const burstStart = Date.now();
let lastNotify = burstStart;
for (let index = 1; Date.now() - burstStart < quietMs * 2; index += 1) {
  updater.notify(index % 2 ? "renderer/a.js" : "renderer\\\\b.js");
  updater.notify("data/eyes-tasks.json");
  updater.notify("renderer/booklet.html");
  lastNotify = Date.now();
  await sleep(40);
}
const during = events.filter((event) => event.phase === "detected").length + calls.reload.length;
await updater.whenIdle();
const detected = events.find((event) => event.phase === "detected");
const burst = {
  during,
  quietAfterLast: detected ? detected.at - lastNotify : null,
  quietMs,
  reloads: calls.reload.map((files) => [...files]),
  builds: calls.build,
  phases: events.map((event) => event.phase),
  payload: detected,
};

// maxWaitMs caps a burst that never goes quiet. debounceMs is far longer than
// the burst, so only the cap can start a pass; and the assertion is the
// engine's own "detected" event, not a finished reload — waiting for
// validate + build + reload would time the machine, not the cap.
const capped = make({ debounceMs: 30000, maxWaitMs: 900 });
await capped.start();
const mark = events.length;
await put(root, "renderer/a.js", "const t = 99;\\n");
let cappedDuring = 0;
const started = Date.now();
while (Date.now() - started < 8000) {
  capped.notify("renderer/a.js");
  cappedDuring = events.slice(mark).filter((event) => event.phase === "detected").length;
  if (cappedDuring) break;
  await sleep(50);
}
const cappedFiles = events.slice(mark).find((event) => event.phase === "detected")?.files ?? [];
await capped.whenIdle();
updater.stop();
capped.stop();
console.log(JSON.stringify({ burst, cappedDuring, cappedFiles, stopped: updater.status() }));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory))
        burst = payload["burst"]
        self.assertEqual(0, burst["during"], "nothing fires while the burst is still landing")
        # A timer never fires early, so this bound holds on any machine; the
        # 25 ms only absorbs the gap between Date.now() and libuv's loop clock.
        self.assertGreaterEqual(burst["quietAfterLast"], burst["quietMs"] - 25, "the quiet period is counted from the last notify, not the first")
        self.assertEqual([["renderer/a.js", "renderer/b.js"]], burst["reloads"], "six writes, one reload")
        self.assertEqual(1, burst["builds"])
        self.assertEqual(["watching", "detected", "validating", "building", "reloading", "watching"], burst["phases"])
        self.assertEqual(
            {"phase", "kind", "files", "error", "reason", "auto", "watching", "at", "pollMs"},
            set(burst["payload"]),
            "update:event payload shape",
        )
        self.assertEqual("reload", burst["payload"]["kind"])
        self.assertGreaterEqual(payload["cappedDuring"], 1, "maxWaitMs forces an action during an endless burst")
        self.assertEqual(["renderer/a.js"], payload["cappedFiles"], "the capped pass carries the burst's file")
        self.assertEqual("idle", payload["stopped"]["phase"])
        self.assertFalse(payload["stopped"]["watching"])

    def test_debounce_coalesces_a_burst_into_one_action(self):
        # Sleep-timing waits on the real engine: a machine loaded by parallel
        # agent runs can transiently overrun the quiet period. A failure that
        # clears on immediate re-run is captured as a flake; one that
        # reproduces re-raises the original so the gate keeps failing.
        retry_transient(self._debounce_probe, self.id(), "debounce burst timing on the real engine")

    def test_auto_off_holds_pending_until_apply_now(self):
        script = self.FIXTURE + """
await seed(root);
const updater = make({ auto: false });
await updater.start();
await put(root, "renderer/a.js", "const a = 12345;\\n");
updater.notify("renderer/a.js");
await updater.whenIdle();
const pending = { status: updater.status(), reloads: calls.reload.length, builds: calls.build };
const applied = await updater.applyNow();
const after = { status: updater.status(), reloads: calls.reload.length };
const idleApply = await updater.applyNow();

// A broken file holds; the fix releases it with the cumulative file list.
updater.setAuto(true);
await put(root, "renderer/b.js", "const = ;\\n");
updater.notify("renderer/b.js");
await updater.whenIdle();
const held = { status: updater.status(), reloads: calls.reload.length };
await put(root, "renderer/b.js", "const b = 777;\\n");
await put(root, "renderer/styles.css", "body { color: gold; }\\n");
updater.notify("renderer/b.js");
await updater.whenIdle();
updater.stop();
console.log(JSON.stringify({ pending, applied, after, idleApply, held, lastReload: calls.reload[calls.reload.length - 1], reloads: calls.reload.length }));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory))
        self.assertEqual("pending", payload["pending"]["status"]["phase"])
        self.assertEqual(["renderer/a.js"], payload["pending"]["status"]["files"])
        self.assertEqual(0, payload["pending"]["reloads"])
        self.assertEqual(0, payload["pending"]["builds"], "auto off stops the pipeline right after detection")
        self.assertTrue(payload["applied"]["applied"])
        self.assertEqual("reload", payload["applied"]["kind"])
        self.assertEqual(1, payload["after"]["reloads"])
        self.assertEqual("watching", payload["after"]["status"]["phase"])
        self.assertTrue(payload["idleApply"]["ok"])
        self.assertFalse(payload["idleApply"]["applied"], "nothing pending: main.cjs turns this into a plain manual restart")
        self.assertEqual("held", payload["held"]["status"]["phase"])
        self.assertEqual("syntax error", payload["held"]["status"]["reason"])
        self.assertIn("renderer/b.js", payload["held"]["status"]["error"])
        self.assertEqual(1, payload["held"]["reloads"], "a broken file never reaches reload/restart")
        self.assertEqual(["renderer/b.js", "renderer/styles.css"], payload["lastReload"])
        self.assertEqual(2, payload["reloads"])

    def _idle_poll_probe(self):
        """The safety-net poll pauses while hidden, backs off on unchanged reads, and still catches a change made while hidden on the first visible walk."""
        script = self.FIXTURE + """
await seed(root);
const constants = await import(__UPDATER_URL__);
let hiddenNow = true;
const updater = make({ pollMs: 1000, hidden: () => hiddenNow });
await updater.start();
// A change lands while the window is hidden: the poll must not walk, so
// nothing fires even though the tree now differs from the baseline.
await put(root, "renderer/a.js", "const a = 1;\\n");
await sleep(2300);
const whileHidden = { reloads: calls.reload.length, pollMs: updater.status().pollMs };
// Visible again: the very next walk diffs against the baseline it kept, so
// the missed change applies within one cadence — the UI never goes stale.
hiddenNow = false;
const reviveStarted = Date.now();
while (calls.reload.length === 0 && Date.now() - reviveStarted < 9000) await sleep(50);
const revived = { reloads: calls.reload.map((files) => [...files]), pollMs: updater.status().pollMs };
// Idle and visible: every unchanged walk multiplies the delay toward
// POLL_MAX_MS, so the idle stat-walk rate decays instead of staying at base.
const mark = updater.status().pollMs;
await sleep(mark * 1.3 + 150);
const backedOff = updater.status().pollMs;
updater.stop();
console.log(JSON.stringify({
  exported: { POLL_INTERVAL_MS: constants.POLL_INTERVAL_MS, POLL_BACKOFF_FACTOR: constants.POLL_BACKOFF_FACTOR, POLL_MAX_MS: constants.POLL_MAX_MS, defaultPollMs: constants.DEFAULTS.pollMs },
  whileHidden, revived, mark, backedOff,
}));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory))
        exported = payload["exported"]
        self.assertEqual(15000, exported["POLL_INTERVAL_MS"])
        self.assertEqual(exported["POLL_INTERVAL_MS"], exported["defaultPollMs"], "DEFAULTS.pollMs is the exported interval constant")
        self.assertGreaterEqual(exported["POLL_BACKOFF_FACTOR"], 2, "quiet reads multiply the cadence")
        self.assertGreater(exported["POLL_MAX_MS"], exported["POLL_INTERVAL_MS"], "the backoff has room above the base cadence")
        self.assertEqual(0, payload["whileHidden"]["reloads"], "a hidden window pauses the stat walk: the missed change fires nothing while paused")
        self.assertEqual(1000, payload["whileHidden"]["pollMs"], "the hidden pause keeps the base cadence so the pause itself is short")
        self.assertEqual([["renderer/a.js"]], payload["revived"]["reloads"], "the first visible walk applies the change missed while hidden — no stale UI")
        self.assertGreaterEqual(payload["backedOff"], payload["mark"] * exported["POLL_BACKOFF_FACTOR"], "an unchanged idle read backs the next walk off")

    def test_idle_poll_pauses_hidden_and_backs_off(self):
        # Same flake family as the debounce burst: the backoff sleeps and the
        # revive loop time a live subprocess, so a one-shot failure that
        # clears on immediate re-run is captured instead of failing the gate.
        retry_transient(self._idle_poll_probe, self.id(), "idle-poll pause/backoff timing on the real engine")

    def test_idle_poll_wiring_is_pinned(self):
        """The engine schedules with re-armed timeouts, main.cjs supplies the visibility probe, and overhead's sheet poll carries the same shape with its window export pinned only to the open/close consumer surface."""
        for marker in ("export const POLL_INTERVAL_MS", "export const POLL_BACKOFF_FACTOR", "export const POLL_MAX_MS"):
            with self.subTest(source="updater", marker=marker):
                self.assertIn(marker, self.updater)
        self.assertNotIn("setInterval(", self.updater, "the poll re-arms a timeout each pass so its delay can change")
        for marker in ('typeof state.hidden === "function"', "isHidden || changed"):
            with self.subTest(source="updater pollOnce", marker=marker):
                self.assertIn(marker, self.updater)
        for marker in ("hidden: () => {", "!window.isVisible()"):
            with self.subTest(source="main.cjs", marker=marker):
                self.assertIn(marker, self.main)
        for marker in (
            "const POLL_INTERVAL_MS = 15000",
            "const POLL_MAX_MS = 60000",
            'if (document.visibilityState !== "visible")',
            "Math.min(pollDelay * 2, POLL_MAX_MS)",
        ):
            with self.subTest(source="overhead.js", marker=marker):
                self.assertIn(marker, self.overhead)
        # The export is pinned as the consumer surface only: a MefiOverhead
        # global that exposes open/close. The member list stays free to change
        # because init and the POLL_* constants have no runtime consumers.
        booklet = read_text(STUDIO / "renderer" / "booklet.html")
        for label, source in (("overhead.js", self.overhead), ("built booklet", booklet)):
            with self.subTest(source=label, marker="window.MefiOverhead exposes open/close"):
                export = re.search(r"window\.MefiOverhead = \{[^{}]*\}", source)
                self.assertIsNotNone(export, "the MefiOverhead global assignment must exist")
                self.assertIn("open", export.group(), "the MefiOverhead export must expose open")
                self.assertIn("close", export.group(), "the MefiOverhead export must expose close")
        for marker in ("const POLL_MAX_MS = 60000",):
            with self.subTest(source="built booklet", marker=marker):
                self.assertIn(marker, booklet, "the shipped page carries the paused, backing-off poll")

    def test_restart_loop_guard(self):
        script = self.FIXTURE + """
await seed(root);
let clock = 1_800_000_000_000;
const updater = make({ now: () => clock, restartHistory: [clock - 5000] });
await updater.start();
const phases = [];
for (let round = 1; round <= 3; round += 1) {
  await put(root, "main.cjs", `// main ${"x".repeat(round)}\\n`);
  updater.notify("main.cjs");
  await updater.whenIdle();
  phases.push(updater.status().phase);
  clock += 4000;
}
const held = updater.status();
const restartsWhenHeld = calls.restart.length;
const buildsWhenHeld = calls.build;
clock += 61000;
await put(root, "renderer/a.js", "const a = 4242;\\n");
updater.notify("renderer/a.js");
await updater.whenIdle();
const released = { phase: updater.status().phase, restarts: calls.restart.map((files) => [...files]), reloads: calls.reload.length };

// A deferred restart (Love2D still running) parks as pending instead of counting.
const deferring = make({ now: () => clock, actions: { restart: async () => ({ deferred: true, reason: "Love2D is running" }) } });
await deferring.start();
await put(root, "main.cjs", "// main changed again\\n");
deferring.notify("main.cjs");
await deferring.whenIdle();
const deferred = deferring.status();
updater.stop();
deferring.stop();
console.log(JSON.stringify({ phases, held, restartsWhenHeld, buildsWhenHeld, released, deferred }));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory))
        self.assertEqual(["watching", "watching", "held"], payload["phases"], "one persisted restart + two live ones, the third inside 60 s is held")
        self.assertEqual("restart loop", payload["held"]["reason"])
        self.assertEqual(2, payload["restartsWhenHeld"])
        self.assertEqual(2, payload["buildsWhenHeld"], "the loop guard runs before the build, so a held restart never leaves the payload ahead of the process")
        self.assertEqual("watching", payload["released"]["phase"])
        self.assertEqual(["main.cjs", "renderer/a.js"], payload["released"]["restarts"][-1], "the held restart is not forgotten: the next change after a quiet minute carries it")
        self.assertEqual(0, payload["released"]["reloads"])
        self.assertEqual("pending", payload["deferred"]["phase"])
        self.assertEqual("Love2D is running", payload["deferred"]["reason"])

    def test_in_place_actions_and_pause_gate(self):
        """Styles inject and modules swap in place; only a reload or restart waits behind the host's pause gate."""
        script = self.FIXTURE + """
await seed(root);
await put(root, "renderer/styles.css", "body { color: red; }\\n");
await put(root, "scripts/eyes.mjs", "export const eyes = 1;\\n");
const trace = [];
let release = null;
const gate = (kind) => new Promise((resolve) => { trace.push(`gate:${kind}`); release = resolve; });
const host = {
  style: async (files) => { trace.push(`style:${files.join(",")}`); return true; },
  modules: async (rels) => { trace.push(`modules:${rels.join(",")}`); },
  reload: async (files) => { trace.push(`reload:${files.join(",")}`); },
  restart: async (files) => { trace.push(`restart:${files.join(",")}`); },
};
const phasesOf = (from) => events.slice(from).map((event) => event.phase);
const updater = make({ actions: host, gate });
await updater.start();

// 1. a stylesheet edit: styled in place, no gate, no reload
let mark = events.length;
await put(root, "renderer/styles.css", "body { color: blue; }\\n");
updater.notify("renderer/styles.css");
await updater.whenIdle();
const styled = { trace: [...trace], phases: phasesOf(mark) };
trace.length = 0;

// 2. a script module edit: swapped in place, no gate, no reload
mark = events.length;
await put(root, "scripts/eyes.mjs", "export const eyes = 2;\\n");
updater.notify("scripts/eyes.mjs");
await updater.whenIdle();
const swapped = { trace: [...trace], phases: phasesOf(mark) };
trace.length = 0;

// 3. renderer script + module + stylesheet: modules swap first, then the reload waits for the gate
mark = events.length;
await put(root, "renderer/a.js", "const a = 1;\\n");
await put(root, "scripts/eyes.mjs", "export const eyes = 3;\\n");
await put(root, "renderer/styles.css", "body { color: green; }\\n");
updater.notify("renderer/a.js");
updater.notify("scripts/eyes.mjs");
updater.notify("renderer/styles.css");
const waiting = new Promise((resolve) => { const tick = () => (updater.status().phase === "waiting" ? resolve(updater.status()) : setTimeout(tick, 20)); tick(); });
const seenWaiting = await waiting;
const beforeRelease = { trace: [...trace], phase: seenWaiting.phase, reason: seenWaiting.reason, busy: updater.isBusy() };
release();
await updater.whenIdle();
const reloaded = { trace: [...trace], phases: phasesOf(mark), status: updater.status() };
trace.length = 0;

// 4. a manual apply skips the gate
mark = events.length;
await put(root, "renderer/a.js", "const a = 2;\\n");
const forced = await updater.applyNow();
await updater.whenIdle();
const manual = { trace: [...trace], phases: phasesOf(mark), applied: forced.applied };
trace.length = 0;

// 5. main.cjs: the restart waits for the gate too
mark = events.length;
await put(root, "main.cjs", "// main 1\\n");
updater.notify("main.cjs");
await new Promise((resolve) => { const tick = () => (updater.status().phase === "waiting" ? resolve() : setTimeout(tick, 20)); tick(); });
const restartTraceWhileWaiting = [...trace];
release();
await updater.whenIdle();
const restarted = { trace: [...trace], phases: phasesOf(mark) };
trace.length = 0;
updater.stop();

// 6. a host that cannot take styles live falls back to the reload; one without a module swap restarts
const plain = make({ actions: { reload: host.reload, restart: host.restart, style: async () => false } });
await plain.start();
await put(root, "renderer/styles.css", "body { color: black; }\\n");
plain.notify("renderer/styles.css");
await plain.whenIdle();
const fallbackStyle = [...trace];
trace.length = 0;
await put(root, "scripts/eyes.mjs", "export const eyes = 4;\\n");
plain.notify("scripts/eyes.mjs");
await plain.whenIdle();
const fallbackModules = [...trace];
plain.stop();
console.log(JSON.stringify({ styled, swapped, beforeRelease, reloaded, manual, restartTraceWhileWaiting, restarted, fallbackStyle, fallbackModules }));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory))
        self.assertEqual(["style:renderer/styles.css"], payload["styled"]["trace"], "a stylesheet edit is injected, never reloaded")
        self.assertIn("styling", payload["styled"]["phases"])
        self.assertNotIn("waiting", payload["styled"]["phases"])
        self.assertEqual(["modules:scripts/eyes.mjs"], payload["swapped"]["trace"], "a script edit is swapped in process, never reloaded or restarted")
        self.assertIn("swapping", payload["swapped"]["phases"])
        self.assertNotIn("waiting", payload["swapped"]["phases"])
        self.assertEqual(["modules:scripts/eyes.mjs", "gate:reload"], payload["beforeRelease"]["trace"], "modules swap before the gate; the reload waits behind it")
        self.assertEqual("waiting", payload["beforeRelease"]["phase"])
        self.assertEqual("waiting for a pause", payload["beforeRelease"]["reason"])
        self.assertTrue(payload["beforeRelease"]["busy"], "a pass waiting for a pause is still a pass in flight")
        self.assertEqual(["modules:scripts/eyes.mjs", "gate:reload", "reload:renderer/a.js,renderer/styles.css,scripts/eyes.mjs"], payload["reloaded"]["trace"])
        self.assertEqual("watching", payload["reloaded"]["status"]["phase"])
        self.assertIsNone(payload["reloaded"]["status"]["reason"], "the pause reason does not outlive the wait")
        self.assertEqual(["reload:renderer/a.js"], payload["manual"]["trace"], "Apply update now never waits for a pause")
        self.assertNotIn("waiting", payload["manual"]["phases"])
        self.assertTrue(payload["manual"]["applied"])
        self.assertEqual(["gate:restart"], payload["restartTraceWhileWaiting"])
        self.assertEqual(["gate:restart", "restart:main.cjs"], payload["restarted"]["trace"])
        self.assertEqual(["reload:renderer/styles.css"], payload["fallbackStyle"], "a page that cannot take styles live gets the reload")
        self.assertEqual(["restart:scripts/eyes.mjs"], payload["fallbackModules"], "a host without an in-process swap keeps the old restart")

    def test_host_applies_updates_in_place_and_waits_for_a_pause(self):
        """main.cjs gives the engine the in-place actions and the pause gate, and a restart keeps the window where it was."""
        for marker in (
            "async function applyStyle(",
            "async function applyModules(",
            "async function awaitPause(",
            "function loadModule(",
            "function invalidateModules(",
            "style: applyStyle",
            "modules: applyModules",
            "gate: awaitPause",
            "window.MefiNav?.applyStyles?.(",
            "window.MefiNav?.activity?.()",
            'phase: "styled"',
            'phase: "swapped"',
            "savedWindowBounds",
        ):
            with self.subTest(marker=marker):
                self.assertIn(marker, self.main)
        self.assertNotIn("setInterval(", self.main.split("async function awaitPause(")[1].split("\n}\n")[0], "the gate polls with timeouts, never an interval it could leak")

    def test_packaged_catch_up_sync_and_runtime_guard(self):
        script = self.FIXTURE + """
const source = path.join(root, "repo", "mefi-studio");
const app = path.join(root, "dist", "resources", "app");
await seed(source);
await seed(app);
await put(app, "data/eyes-tasks.json", "LIVE");
await put(source, "renderer/a.js", "const a = 'edited while the app was closed';\\n");
const packaged = make({ sourceRoot: source, appRoot: app, packaged: true, runtimeVersion: "99.0.0", build: async ({ root: target }) => { calls.build += 1; await put(target, "renderer/booklet.html", "BUILT"); return {}; } });
await packaged.start();
await packaged.whenIdle();
const caughtUp = { reloads: calls.reload.map((files) => [...files]), a: await readFile(path.join(app, "renderer/a.js"), "utf8"), booklet: await readFile(path.join(app, "renderer/booklet.html"), "utf8"), data: await readFile(path.join(app, "data/eyes-tasks.json"), "utf8"), phases: events.map((event) => event.phase) };
packaged.stop();

const mismatch = make({ sourceRoot: source, appRoot: app, packaged: true, runtimeVersion: "44.4.1" });
await mismatch.start();
await put(source, "renderer/b.js", "const b = 'never synced';\\n");
mismatch.notify("renderer/b.js");
await mismatch.whenIdle();
const guarded = { status: mismatch.status(), b: await readFile(path.join(app, "renderer/b.js"), "utf8"), reloads: calls.reload.length };
mismatch.stop();
console.log(JSON.stringify({ caughtUp, guarded }));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory))
        self.assertEqual([["renderer/a.js"]], payload["caughtUp"]["reloads"], "a payload that is older than the source catches up on start")
        self.assertIn("edited while the app was closed", payload["caughtUp"]["a"])
        self.assertEqual("BUILT", payload["caughtUp"]["booklet"], "the rebuilt booklet is synced with the changed files")
        self.assertEqual("LIVE", payload["caughtUp"]["data"])
        self.assertIn("syncing", payload["caughtUp"]["phases"])
        self.assertEqual("held", payload["guarded"]["status"]["phase"])
        self.assertTrue(payload["guarded"]["status"]["reason"].startswith("runtime changed"), payload["guarded"])
        self.assertEqual("const b = 0;\n", payload["guarded"]["b"], "a held update never reaches the payload")
        self.assertEqual(1, payload["guarded"]["reloads"])

    def test_locked_payload_holds_instead_of_half_updating(self):
        script = self.FIXTURE + """
import { readdir, rm } from "node:fs/promises";
const source = path.join(root, "repo", "mefi-studio");
const app = path.join(root, "dist", "resources", "app");
await seed(source);
await seed(app);
// main.cjs makes this a restart-class set: the case where relaunching into a
// half-written payload would boot a mixed-revision app.
await put(source, "main.cjs", "// main 1\\n");
await put(source, "renderer/a.js", "const a = 'fresh';\\n");
await put(source, "renderer/b.js", "const b = 'fresh';\\n");
// renderer/b.js in the payload cannot be replaced: a non-empty directory
// stands in for the antivirus/OneDrive lock that fails rename and copyFile.
await rm(path.join(app, "renderer/b.js"), { force: true });
await put(app, "renderer/b.js/inner.txt", "locked");
const packaged = make({ sourceRoot: source, appRoot: app, packaged: true, runtimeVersion: "99.0.0", build: async ({ root: target }) => { calls.build += 1; await put(target, "renderer/booklet.html", "BUILT"); return {}; } });
await packaged.start();
await packaged.whenIdle();
const leftovers = async () => (await readdir(path.join(app, "renderer"))).filter((name) => name.includes(".sync-tmp"));
const held = {
  status: packaged.status(),
  main: await readFile(path.join(app, "main.cjs"), "utf8"),
  a: await readFile(path.join(app, "renderer/a.js"), "utf8"),
  booklet: await readFile(path.join(app, "renderer/booklet.html"), "utf8"),
  reloads: calls.reload.length,
  restarts: calls.restart.length,
  leftovers: await leftovers(),
};
// The lock clears: the baseline was never adopted, so an apply retries the
// whole held set, not just the file that failed.
await rm(path.join(app, "renderer/b.js"), { recursive: true, force: true });
const retried = await packaged.applyNow();
const after = { status: packaged.status(), b: await readFile(path.join(app, "renderer/b.js"), "utf8"), restarts: calls.restart.map((files) => [...files]), reloads: calls.reload.length, leftovers: await leftovers() };
packaged.stop();
console.log(JSON.stringify({ held, retried, after }));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory))
        held = payload["held"]
        self.assertEqual("held", held["status"]["phase"])
        self.assertEqual("payload locked", held["status"]["reason"])
        self.assertIn("renderer/b.js", held["status"]["error"])
        self.assertEqual("restart", held["status"]["kind"])
        self.assertEqual("// main 1\n", held["main"], "the files before the locked one are still written")
        self.assertEqual("const a = 'fresh';\n", held["a"])
        self.assertEqual("BUILT", held["booklet"], "the files after the locked one are still written")
        self.assertEqual(0, held["reloads"], "a half-written payload never reaches reload")
        self.assertEqual(0, held["restarts"], "a half-written payload never relaunches the app")
        self.assertEqual([], held["leftovers"], "no .sync-tmp is left to fake a change on the next boot")
        self.assertTrue(payload["retried"]["applied"], payload["retried"])
        self.assertEqual("watching", payload["after"]["status"]["phase"])
        self.assertEqual("const b = 'fresh';\n", payload["after"]["b"])
        self.assertEqual([["main.cjs", "renderer/a.js", "renderer/b.js"]], payload["after"]["restarts"], "the retry carries the whole held set")
        self.assertEqual(0, payload["after"]["reloads"])
        self.assertEqual([], payload["after"]["leftovers"])

    def test_apply_during_a_run_is_queued_and_still_applied(self):
        script = self.FIXTURE + """
await seed(root);
let release;
let gate = new Promise((resolve) => { release = resolve; });
let reachedBuild;
const atBuild = new Promise((resolve) => { reachedBuild = resolve; });
const updater = make({ build: async () => { calls.build += 1; if (gate) { const waiting = gate; gate = null; reachedBuild(); await waiting; } return {}; } });
await updater.start();
await put(root, "renderer/a.js", "const a = 1;\\n");
const first = updater.applyNow();
await atBuild;
// Auto-restart off: from here only an explicit apply may go through, so a
// second apply that lands mid-run has to carry its own force with it.
updater.setAuto(false);
const queued = await updater.applyNow();
await put(root, "renderer/b.js", "const b = 2;\\n");
release();
await first;
await updater.whenIdle();
const status = updater.status();
updater.stop();
console.log(JSON.stringify({ queued, status, reloads: calls.reload.map((files) => [...files]) }));
"""
        with tempfile.TemporaryDirectory() as directory:
            payload = self.run_module(script, ROOT=Path(directory))
        self.assertTrue(payload["queued"]["queued"], "an apply during a run is queued, not applied on the spot")
        self.assertFalse(payload["queued"]["applied"])
        self.assertNotIn(
            payload["queued"]["phase"],
            ("held", "error"),
            "the queued phase is a busy phase, which main.cjs must not read as 'nothing pending' and turn into a restart",
        )
        self.assertEqual([["renderer/a.js"], ["renderer/b.js"]], payload["reloads"], "the queued apply still applies, with auto-restart off")
        self.assertEqual("watching", payload["status"]["phase"])
        self.assertFalse(payload["status"]["auto"])

    def test_build_honours_root_and_leaves_the_committed_booklet_alone(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        committed = STUDIO / "renderer" / "booklet.html"
        before = committed.read_bytes()
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "renderer").mkdir()
            (root / "data").mkdir()
            for source in (STUDIO / "renderer").iterdir():
                if source.suffix in (".js", ".css") or source.name == "booklet.template.html":
                    shutil.copy2(source, root / "renderer" / source.name)
            shutil.copy2(STUDIO / "data" / "models.json", root / "data" / "models.json")
            script = """
import { build } from __BUILD_URL__;
const first = await build({ root: __ROOT__ });
const second = await build({ root: __ROOT__ });
console.log(JSON.stringify({ first, second }));
"""
            payload = self.run_module(script, ROOT=root)
            built = (root / "renderer" / "booklet.html").read_text(encoding="utf-8")
            self.assertEqual(str(root / "renderer" / "booklet.html"), payload["first"]["out"])
        # The comparison reads the live committed catalog, which a concurrent
        # catalog rebuild can be caught mid-writing — same flake family as
        # test_mefi_studio_catalog's setUpClass loads.
        def live_catalog_probe():
            catalog = json.loads((STUDIO / "data" / "models.json").read_text(encoding="utf-8"))
            self.assertEqual(len(catalog["models"]), payload["first"]["models"])
            self.assertEqual(catalog["hash"], payload["first"]["hash"])

        retry_transient(live_catalog_probe, self.id(), "live data/models.json read against the temp-root build")
        self.assertTrue(payload["first"]["changed"])
        self.assertFalse(payload["second"]["changed"], "an identical rebuild does not rewrite the file")
        for placeholder in ("__BOOKLET_DATA__", "__BOOKLET_STYLES__", "__BOOKLET_CODE__"):
            self.assertNotIn(placeholder, built)
        self.assertIn("MefiToast", built)
        self.assertEqual(before, committed.read_bytes(), "build({ root }) must not touch this app's booklet")


if __name__ == "__main__":
    unittest.main()
