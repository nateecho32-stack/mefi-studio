"""Offline-with-key AI probe contracts for Mefi's Studio AI+ (standalone repo).

The one state nothing used to watch: a key is present, the AI never answered
(online false, failures 0), so no real call is owed and no backoff runs — the
loop sat unprobed forever. planOfflineProbe (scripts/assistant.mjs) turns that
exact state into a single queued probe; main.cjs arms it on every assistant
tick, fires it through assistantFetch, and backs the wait off by doubling per
failed probe. The planner is simulated here through the real module (no
network, no key, no Electron); the wiring is pinned as static contracts.
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
MAIN = STUDIO / "main.cjs"
NODE = shutil.which("node")

NOW = 1_800_000_000_000
MINUTE = 60_000


def _plan_with(ai, **options):
    """Run the real planner once and return its JSON verdict."""
    script = (
        "import { planOfflineProbe } from './scripts/assistant.mjs';"
        f"const ai = {json.dumps(ai)};"
        f"const options = {json.dumps(options)};"
        "const plan = planOfflineProbe(ai, 1800000000000, options);"
        "console.log(JSON.stringify({ plan }));"
    )
    result = subprocess.run([NODE, "--input-type=module", "-e", script], cwd=STUDIO, capture_output=True, text=True, encoding="utf-8", timeout=60)
    if result.returncode != 0:
        raise AssertionError(result.stderr)
    return json.loads(result.stdout)["plan"]


def _offline_with_key():
    return {"keyPresent": True, "online": False, "failures": 0, "backoffUntil": 0}


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


class MefiStudioOfflineProbeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.main = MAIN.read_text(encoding="utf-8")
        cls.assistant = ASSISTANT.read_text(encoding="utf-8")

    # --- runtime: the planner through the real module --------------------------------------

    def test_offline_with_key_queues_one_probe_at_the_base_delay(self):
        plan = _plan_with(_offline_with_key())
        self.assertIsNotNone(plan, "offline with a key and zero failures must queue a probe")
        self.assertEqual(90_000, plan["delay"], "the first probe waits the base delay, not zero")
        self.assertEqual(1_800_000_000_000 + 90_000, plan["at"])
        self.assertEqual(0, plan["attempts"])

    def test_pending_probe_blocks_a_requeue(self):
        # A tick that runs while a probe is already queued must not queue a
        # second one: exactly one probe per offline stretch.
        queued = _plan_with(_offline_with_key())
        again = _plan_with(_offline_with_key(), pendingUntil=1_800_000_000_000 + queued["delay"], attempts=0)
        self.assertIsNone(again, "a pending probe must block a duplicate queueing")

    def test_failed_probe_doubles_the_wait(self):
        # After a failed probe the next wait grows: the delay is the base
        # doubled per recorded attempt, and the same wait rides backoffUntil.
        second = _plan_with(_offline_with_key(), attempts=1)
        self.assertEqual(180_000, second["delay"])
        third = _plan_with(_offline_with_key(), attempts=2)
        self.assertEqual(360_000, third["delay"])

    def test_probe_backoff_is_capped(self):
        script = (
            "import { offlineProbeDelayMs, OFFLINE_PROBE_MAX_MS } from './scripts/assistant.mjs';"
            "const capped = offlineProbeDelayMs(40);"
            "if (capped !== OFFLINE_PROBE_MAX_MS) throw new Error('delay must cap at ' + OFFLINE_PROBE_MAX_MS + ', got ' + capped);"
            "if (OFFLINE_PROBE_MAX_MS !== 30 * 60000) throw new Error('cap is 30 minutes');"
            "console.log(JSON.stringify({ ok: true }));"
        )
        result = subprocess.run([NODE, "--input-type=module", "-e", script], cwd=STUDIO, capture_output=True, text=True, encoding="utf-8", timeout=60)
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)

    def test_other_states_stay_unprobed(self):
        for name, ai, options in (
            ("no key", {"keyPresent": False, "online": False, "failures": 0, "backoffUntil": 0}, {}),
            ("online", {"keyPresent": True, "online": True, "failures": 0, "backoffUntil": 0}, {}),
            ("real failure recorded", {"keyPresent": True, "online": False, "failures": 1, "backoffUntil": 0}, {}),
            ("owed backoff", {"keyPresent": True, "online": False, "failures": 0, "backoffUntil": 1_800_000_000_000 + MINUTE}, {}),
            ("garbage state", None, {}),
        ):
            with self.subTest(case=name):
                self.assertIsNone(_plan_with(ai, **options), f"{name} must not queue a probe")

    # --- static: main.cjs wiring -------------------------------------------------------------

    def test_tick_arms_the_probe_after_the_key_check(self):
        # The arm must sit after the keyPresent refresh (fresh input) and
        # before the no-project early return, so every tick pass re-plans.
        tick = _function_body(self.main, "assistantTick")
        key_line = tick.index("assistantState.ai.keyPresent = await assistantKeyPresent();")
        arm_line = tick.index("scheduleAssistantAiProbe();")
        no_project = tick.index("if (!projects.open()) {")
        self.assertLess(key_line, arm_line)
        self.assertLess(arm_line, no_project)
        self.assertIn("planOfflineProbe", self.main)

    def test_scheduler_queues_at_most_one_probe(self):
        schedule = _function_body(self.main, "scheduleAssistantAiProbe")
        self.assertIn("const plan = assistantAiProbePlan();", schedule)
        self.assertIn("if (!plan || assistantAiProbeRunning) return;", schedule, "no plan, no probe; an in-flight probe blocks a second")
        self.assertIn("clearAssistantAiProbe();", schedule, "a re-arm replaces, never stacks, timers")
        self.assertIn("assistantAiProbePendingUntil = Date.now() + plan.delay;", schedule)
        self.assertIn("assistantAiProbeTimer.unref?.();", schedule, "the probe timer must not hold the process open")
        runner = _function_body(self.main, "runAssistantAiProbe")
        self.assertIn("assistantAiProbeRunning = true;", runner)
        self.assertIn("assistantAiProbeRunning = false;", runner, "the in-flight flag clears even when the call throws")

    def test_runner_skips_smoke_capture_and_stale_states(self):
        runner = _function_body(self.main, "runAssistantAiProbe")
        # head is the runner up to (not including) assistantFetch, so every
        # guard found in it necessarily sits before the call: smoke and
        # capture runs, a paused loop, and a state that moved on while the
        # timer sat queued (a real call answered or failed into the usual
        # backoff) all drop the probe before any request is spent.
        head = runner[: runner.index("assistantFetch")]
        for guard in ("SMOKE", "CAPTURE", 'assistantState.status !== "running"', "!assistantAiProbePlan()"):
            self.assertIn(guard, head, f"the probe must be dropped before any call when {guard}")

    def test_success_marks_online_the_usual_way(self):
        runner = _function_body(self.main, "runAssistantAiProbe")
        self.assertIn("if (call.ok) {", runner)
        ok_branch = runner[runner.index("if (call.ok) {") : runner.index("assistantAiProbeAttempts += 1;")]
        self.assertIn("assistantAiOk();", ok_branch, "a passing probe flips online through the shared path")
        self.assertIn('assistantSetProblems(["ai-offline"], []);', ok_branch, "and clears the offline problem")

    def test_failure_grows_backoff_without_touching_failures(self):
        runner = _function_body(self.main, "runAssistantAiProbe")
        self.assertIn("assistantAiProbeAttempts += 1;", runner)
        self.assertIn("ai.backoffUntil = Date.now() + delay;", runner, "the AI-gated cadence roles must respect the probe wait")
        self.assertIn("offlineProbeDelayMs", runner, "the wait comes from the shared backoff curve")
        self.assertNotIn("ai.failures += 1;", runner, "a probe is not a real call: failures stays zero so the probe guard keeps guarding")
        self.assertIn("scheduleAssistantAiProbe();", runner, "the next probe is queued with the grown delay")

    def test_ok_failure_and_control_paths_reset_the_probe(self):
        ok = _function_body(self.main, "assistantAiOk")
        self.assertIn("assistantAiProbeAttempts = 0;", ok)
        self.assertIn("clearAssistantAiProbe();", ok)
        for name in ("assistantPause", "stopAssistant"):
            self.assertIn("clearAssistantAiProbe();", _function_body(self.main, name), f"{name} must drop a queued probe")

    def test_docs_register_this_contract(self):
        guide = (ROOT / "TESTRUNS.md").read_text(encoding="utf-8")
        self.assertIn("`tools/test_mefi_studio_offline_probe.py`", guide)


if __name__ == "__main__":
    unittest.main()
