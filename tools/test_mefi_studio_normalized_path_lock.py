"""Normalized-path lock contract for Mefi's Studio AI+ (standalone repository).

The executor's spawn loop must not let two jobs edit one file under two
spellings of its path. A-Eyes watched sessions collide this way: one session
claims ``tools\\test_mefi_studio_eyes.py`` (backslashes, mixed case) while the
next claims ``tools/test_mefi_studio_eyes.py`` and both start editing. The
lock therefore normalizes before comparing: forward/backward separators
collapse, trailing separators drop, case folds, an absolute path matches its
repo-relative tail, and a bare basename agrees with the same basename under
any folder. claimWork() then defers a pick whose files a sibling executor job
already holds (reason "claimed"), a finished job releases its claim, and an
unrelated file proceeds — without a lease file (that hung dispatch on
OneDrive). The behavioral half drives the real scripts/assistant.mjs exports
(filesOverlap, claimedFiles, claimWork) through a Node stdin driver; the
static half pins the normalization lines and the main.cjs consultation. Node
checks skip cleanly without Node.
"""
from pathlib import Path
import json
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
ASSISTANT = ROOT / "scripts" / "assistant.mjs"
MAIN = ROOT / "main.cjs"
NODE = shutil.which("node")

EYES = "tools/test_mefi_studio_eyes.py"


def _run_driver(script):
    result = subprocess.run(
        [NODE, "--input-type=module", "-", str(ROOT)],
        input=script,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )
    return result


DRIVER = """
import { pathToFileURL } from "node:url";
import path from "node:path";
const { filesOverlap, claimedFiles, claimWork } = await import(
  pathToFileURL(path.resolve(process.argv[2], "scripts", "assistant.mjs")).href
);
const EYES = "tools/test_mefi_studio_eyes.py";
console.log(JSON.stringify({
  slash: filesOverlap(["tools\\\\test_mefi_studio_eyes.py"], [EYES]),
  case: filesOverlap(["Tools/TEST_MEFI_STUDIO_EYES.PY"], [EYES]),
  abs: filesOverlap(["C:/repo/tools/test_mefi_studio_eyes.py"], [EYES]),
  trail: filesOverlap(["tools/test_mefi_studio_eyes.py/"], [EYES]),
  diff: filesOverlap(["tools/other.py"], [EYES]),
  base: filesOverlap(["elsewhere/eyes.py"], ["tools/eyes.py"]),
  empty: filesOverlap([], ["x"]),
}));
const held = claimWork({ work: { title: "Resolve collision: test_mefi_studio_eyes.py", files: [EYES] }, jobs: [{ id: "j1", files: ["tools\\\\TEST_MEFI_STUDIO_EYES.py"] }] });
console.log(JSON.stringify({ action: held.action, reason: held.reason, files: held.files, advice: held.advice }));
const released = claimWork({ work: { title: "same file", files: [EYES] }, jobs: [{ id: "j1", files: [EYES], finished: true }] });
console.log(JSON.stringify({ action: released.action, reason: released.reason }));
const unrelated = claimWork({ work: { title: "other file", files: ["renderer/styles.css"] }, jobs: [{ id: "j1", files: [EYES] }] });
console.log(JSON.stringify({ action: unrelated.action, reason: unrelated.reason }));
const labels = claimedFiles([{ files: [EYES] }, { files: ["renderer\\\\styles.css"] }, { finished: true, files: ["gone.js"] }]);
console.log(JSON.stringify(labels));
"""


class NormalizedPathLockTests(unittest.TestCase):
    def test_contract_documented_in_testruns(self):
        guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")
        self.assertIn("`tools/test_mefi_studio_normalized_path_lock.py`", guide)

    def test_static_lock_normalizes_paths_before_comparing(self):
        module = ASSISTANT.read_text(encoding="utf-8")
        # sameFile folds separators, trailing separators and case before comparing
        self.assertIn('String(a ?? "").replace(/[\\\\/]+/g, "/").replace(/\\/+$/, "").toLowerCase()', module)
        # one spelling matches the other as a path tail or by basename
        self.assertIn("left.endsWith(`/${right}`) || right.endsWith(`/${left}`) || basename(left) === basename(right)", module)
        # claimWork filters held sibling claims through the same normalizer
        self.assertIn("held.filter((file) => named.some((item) => sameFile(file, item)))", module)
        # the deferred pick names the reason and advice, and writes no lease file
        self.assertIn('action: "defer",\n      reason: "claimed",', module)
        self.assertIn("Another in-flight job already claimed", module)
        self.assertIn("it must not write a lease file", module)
        # finished jobs release their claim before the comparison
        self.assertIn("if (!isObject(job) || job.finished) continue;", module)

    def test_static_theme_keys_share_the_normalizer(self):
        module = ASSISTANT.read_text(encoding="utf-8")
        # adopted work: collision theme keys use the normalized basename, so a
        # Fix about the backslash spelling groups with the forward-slash one
        self.assertIn("Basename of a path, normalized the way sameFile compares them", module)
        self.assertIn("function sameFileLabel(file) {", module)

    def test_static_spawn_loop_consults_the_lock(self):
        main = MAIN.read_text(encoding="utf-8")
        self.assertIn("assistantModule?.claimWork", main, "the dispatcher defers picks whose files a sibling job holds")

    def test_behavior_lock_defers_a_respelled_claim(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        result = _run_driver(DRIVER)
        self.assertEqual(0, result.returncode, result.stderr)
        overlaps, held, released, unrelated, labels = (json.loads(line) for line in result.stdout.splitlines())
        # every respelling of one path is the same file to the lock
        self.assertTrue(overlaps["slash"], "backslashes and forward slashes agree")
        self.assertTrue(overlaps["case"], "case differences agree")
        self.assertTrue(overlaps["abs"], "an absolute path agrees with its relative tail")
        self.assertTrue(overlaps["trail"], "a trailing separator is dropped")
        self.assertTrue(overlaps["base"], "a bare basename agrees with the same basename under any folder")
        self.assertFalse(overlaps["diff"], "two different files stay different")
        self.assertFalse(overlaps["empty"], "an empty side never matches")
        # the collision that started this contract: the second pick defers
        self.assertEqual("defer", held["action"])
        self.assertEqual("claimed", held["reason"])
        self.assertIn("test_mefi_studio_eyes.py", held["advice"].lower())
        # a finished job releases its claim; an unrelated file proceeds
        self.assertEqual(("proceed", "proceed"), (released["action"], released["reason"]))
        self.assertEqual(("proceed", "proceed"), (unrelated["action"], unrelated["reason"]))
        # live claims survive dedupe; the finished job's file is gone
        self.assertEqual([EYES, "renderer\\styles.css"], labels)


if __name__ == "__main__":
    unittest.main()
