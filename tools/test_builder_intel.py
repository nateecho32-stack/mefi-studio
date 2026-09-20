"""Builder outcome reporting contracts for Mefi's Studio AI+ (standalone).

Feeds one failed and one finished executor run through the real
scripts/assistant.mjs (the same hearReport main.cjs calls) and pins the
digest counters (digest.builders.reports counts finished runs, fails counts
failed ones, inside the half-hour window — a later finish cannot erase an
earlier failure), the structured builder events each done/fail appends (job
id, role, exit code, verdict — parsed here), their survival across a state
save/reload, and the main.cjs wiring: assistantHearBuilder threads the run's
job id and exit code into the report, the fallback intel row and the emitted
intel event, and the executor's finish path passes the child's exit code.
No network, no key, no Electron; the Node half skips cleanly without Node.

Discovered by npm test through tools/test_mefi_studio_builder_intel.py.
Standalone: python -m unittest discover -s tools -p "test_builder_intel.py".
"""
from pathlib import Path
import json
import re
import shutil
import subprocess
import unittest


ROOT = Path(__file__).resolve().parents[1]
STUDIO = ROOT
ASSISTANT = STUDIO / "scripts" / "assistant.mjs"
NODE = shutil.which("node")

NOW = 1_800_000_000_000


def _function_body(source, name):
    """The braces-balanced body of `function name(` (or `async function name(`)."""
    match = re.search(r"(?:async\s+)?function\s+" + re.escape(name) + r"\s*\(", source)
    if not match:
        return ""
    start = source.index("{", match.end())
    depth = 0
    for index in range(start, len(source)):
        if source[index] == "{":
            depth += 1
        elif source[index] == "}":
            depth -= 1
            if depth == 0:
                return source[start : index + 1]
    return source[start:]


class BuilderIntelTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = (STUDIO / "main.cjs").read_text(encoding="utf-8")
        cls.guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")

    def test_digest_counts_one_failed_and_one_finished_run(self):
        # The acceptance check from the directive: one failed and one finished
        # run leave fails=1 and reports=1 — in either order, because outcomes
        # are events, not a single overwrite-prone intel row.
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        script = """
import { hearReport, overseerDigest, emptyState, normalizeState } from "file:///PROJECT/scripts/assistant.mjs";
const NOW = __NOW__;
const run = (state, ok, job, exit, at) => hearReport(state, { role: "builder", ok, title: `job ${job}`, text: `${ok ? "finished" : "failed"} "job ${job}"`, error: ok ? "" : "boom", handed: 0, job, exit }, at).state;
let forward = emptyState(NOW);
forward = run(forward, true, "run_ok", 0, NOW);
forward = run(forward, false, "run_fail", 1, NOW + 1000);
let backward = emptyState(NOW);
backward = run(backward, false, "run_fail", 1, NOW);
backward = run(backward, true, "run_ok", 0, NOW + 1000);
let stale = emptyState(NOW - 31 * 60000);
stale = run(stale, true, "run_old", 0, NOW - 31 * 60000);
const reloaded = normalizeState(JSON.parse(JSON.stringify(forward)));
console.log(JSON.stringify({
  forward: overseerDigest(forward, NOW + 2000).builders,
  backward: overseerDigest(backward, NOW + 2000).builders,
  events: forward.builderEvents,
  reloaded: reloaded.builderEvents,
  reloadedDigest: overseerDigest(reloaded, NOW + 2000).builders,
  stale: overseerDigest(stale, NOW).builders,
}));
""".replace("PROJECT", STUDIO.as_posix()).replace("__NOW__", str(NOW))
        result = subprocess.run([NODE, "--input-type=module", "-"], input=script, cwd=STUDIO, capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(0, result.returncode, result.stderr)
        payload = json.loads(result.stdout)
        self.assertEqual({"reports": 1, "fails": 1}, payload["forward"], payload)
        self.assertEqual({"reports": 1, "fails": 1}, payload["backward"], "a later finish cannot erase an earlier failure from the digest")
        self.assertEqual({"reports": 0, "fails": 0}, payload["stale"], "outcomes older than half an hour drop out of the window")
        self.assertEqual({"reports": 1, "fails": 1}, payload["reloadedDigest"], payload)
        by_job = {row["job"]: row for row in payload["events"]}
        self.assertEqual({"run_ok", "run_fail"}, set(by_job), payload)
        ok_row = by_job["run_ok"]
        self.assertEqual("builder", ok_row["role"])
        self.assertTrue(ok_row["ok"])
        self.assertEqual(0, ok_row["exit"])
        fail_row = by_job["run_fail"]
        self.assertEqual("builder", fail_row["role"])
        self.assertFalse(fail_row["ok"])
        self.assertEqual(1, fail_row["exit"])
        self.assertEqual(payload["events"], payload["reloaded"], "the structured events survive a state save and reload")

    def test_main_threads_job_id_and_exit_into_the_report(self):
        self.assertIn('function assistantHearBuilder(entry, job, ok, errorMessage = "", exitCode = null)', self.main)
        body = _function_body(self.main, "assistantHearBuilder")
        self.assertIn('const jobId = String(entry?.id ?? "")', body, "the run's id is the job id the event carries")
        for marker in ("job: jobId", "exit: exitCode"):
            with self.subTest(marker=marker):
                self.assertIn(marker, body, "the report, the fallback intel row and the emitted event all carry it")
        self.assertIn("facts: { ok, title: job.title, job: jobId, exit: exitCode }", body, "the emitted intel event is structured: job id, role and exit beside the verdict")
        self.assertIn("assistantHearBuilder(entry, job, ok, errorMessage, code ?? null)", self.main, "the executor's finish path passes the child's exit code")

    def test_docs_register_this_contract(self):
        self.assertIn("`tools/test_builder_intel.py`", self.guide)


if __name__ == "__main__":
    unittest.main()
