"""Overseer verification scheduling contract for Mefi's Studio AI+.

A-Eyes overseer directive: when a builder reports MEFI_RESULT: done,
scripts/assistant.mjs must schedule the overseer's own verification run
(the project's local check plus the task's focused tests) before the task card closes,
and a done report must queue EXACTLY ONE verification job. The scheduler keys
a job by whatever row identity it is handed (driver case 8 keeps that
property); only tasks run now, so main.cjs settles and stamps task rows alone.
The behavioral half drives the real exports (scheduleVerificationOnDone,
focusedTestsForTask, verificationJobKey, parseExecutorResult) through a Node
stdin driver; the static half pins the exports and the main.cjs settlement
wiring for the task settle path. Node checks skip cleanly without Node.
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


def _run_driver(script):
    return subprocess.run(
        [NODE, "--input-type=module", "-", str(ROOT)],
        input=script,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=60,
    )


DRIVER = """
import path from "node:path";
import { pathToFileURL } from "node:url";
const { scheduleVerificationOnDone, focusedTestsForTask, verificationJobKey, findQueuedVerification, parseExecutorResult } = await import(
  pathToFileURL(path.resolve(process.argv[2], "scripts", "assistant.mjs")).href
);
const task = {
  id: "task_f1a2164478ed8fc0",
  title: "Overseer: Verify finished builder attempts",
  files: ["scripts/assistant.mjs"],
  refs: ["tests/foo.test.mjs", "tools/test_mefi_studio_tasks.py"],
};
const done = parseExecutorResult("MEFI_RESULT: done: scheduler queued; remaining: none; ran tests/foo.test.mjs");
// 1. A done report queues exactly one verification job.
const queue = [];
const first = scheduleVerificationOnDone({ resultNote: done, task, attemptKey: "run_1", queue });
// 2. A retried report (same attempt) and a second done line change nothing.
const again = scheduleVerificationOnDone({ resultNote: done, task, attemptKey: "run_1", queue });
const secondLine = parseExecutorResult("MEFI_RESULT: done: duplicate line");
scheduleVerificationOnDone({ resultNote: secondLine, task, attemptKey: "run_1", queue });
// 3. A different attempt of the same task queues its own single job.
const secondAttemptQueue = [];
const secondAttempt = scheduleVerificationOnDone({ resultNote: done, task, attemptKey: "run_2", queue: secondAttemptQueue });
console.log(JSON.stringify({
  queued: first !== null,
  queueLength: queue.length,
  retriedQueued: again !== null,
  checkFirst: queue[0]?.commands?.[0],
  kind: queue[0]?.kind,
  key: queue[0]?.key,
  focused: queue[0]?.commands?.slice(1),
  keyStable: verificationJobKey(task.id, "run_1") === verificationJobKey(task.id, "run_1"),
  secondAttemptQueued: secondAttempt !== null,
  secondAttemptQueueLength: secondAttemptQueue.length,
  distinctKeys: queue[0]?.key !== secondAttemptQueue[0]?.key,
}));
// 4. Non-done results and absent reports queue zero jobs.
const negatives = [
  parseExecutorResult("MEFI_RESULT: failed: check broke"),
  parseExecutorResult("MEFI_RESULT: partial: half the work"),
  null,
];
const rejectQueue = [];
const rejected = negatives.map((note) => scheduleVerificationOnDone({ resultNote: note, task, attemptKey: "run_3", queue }));
console.log(JSON.stringify({ rejectedQueued: rejected.map((row) => row !== null), rejectQueueLength: rejectQueue.length }));
// 5. Prose quoting the protocol mid-line never schedules anything.
const quoted = scheduleVerificationOnDone({
  resultNote: parseExecutorResult("never print MEFI_RESULT: done until the checks pass"),
  task, attemptKey: "run_4", queue: [],
});
console.log(JSON.stringify({ quotedNull: quoted === null }));
// 6. A task with no test-shaped scope resolves to check only.
const bare = { id: "task_bare", title: "no tests named" };
const bareQueue = [];
scheduleVerificationOnDone({
  resultNote: parseExecutorResult("MEFI_RESULT: done: only the docs moved"),
  task: bare, attemptKey: "run_5", queue: bareQueue,
});
console.log(JSON.stringify({ bareCommands: bareQueue[0]?.commands }));
// 7. Focused tests resolve from task scope and the report's ran clause.
const fromScope = focusedTestsForTask(task, done);
const fromNothing = focusedTestsForTask(null, null);
console.log(JSON.stringify({ fromScope, fromNothing }));
// 8. The scheduler keys a job by the row identity it is handed (a legacy
// request key here): one job per attempt, never colliding with a task's.
const { requestKey } = await import(
  pathToFileURL(path.resolve(process.argv[2], "scripts", "agent-modes.cjs")).href
);
const request = { at: 1789893432190, prompt: "fix the stall", title: "fix the stall", files: ["tests/foo.test.mjs"] };
const requestTask = { id: requestKey(request), title: request.title, files: request.files };
const requestQueue = [];
const requestPlanned = scheduleVerificationOnDone({
  resultNote: done, task: requestTask, attemptKey: "run_req_1", queue: requestQueue,
});
const requestRetry = scheduleVerificationOnDone({
  resultNote: done, task: requestTask, attemptKey: "run_req_1", queue: requestQueue,
});
console.log(JSON.stringify({
  requestQueued: requestPlanned !== null,
  requestRetryQueued: requestRetry !== null,
  requestQueueLength: requestQueue.length,
  requestTaskId: requestQueue[0]?.taskId,
  requestKeyed: requestQueue[0]?.key === `verification:${requestTask.id}:run_req_1`,
  requestCommands: requestQueue[0]?.commands,
  noTaskCollision: requestQueue[0]?.key !== queue[0]?.key,
}));
// 9. Partial-commit recovery: the deduped retry returns null (pinned above),
// and findQueuedVerification recovers the existing job by the same key —
// while an attempt that never queued (or a non-done report) finds nothing.
const recovered = findQueuedVerification({ taskId: task.id, attemptKey: "run_1", queue });
const missing = findQueuedVerification({ taskId: task.id, attemptKey: "run_missing", queue });
const notDone = findQueuedVerification({ taskId: task.id, attemptKey: "run_3", queue: rejectQueue });
console.log(JSON.stringify({
  recoveredIsQueuedJob: recovered === queue[0],
  recoveredKey: recovered?.key,
  recoveredCommands: recovered?.commands,
  missingNull: missing === null,
  notDoneNull: notDone === null,
}));
// 10. An observed project with no check must not regain the legacy npm default.
const localTask = { ...bare, projectPath: "C:/fixture-game" };
const noCheck = scheduleVerificationOnDone({ resultNote: secondLine, task: localTask, attemptKey: "run_no_check", queue: [], baseCheck: null });
const localCheck = scheduleVerificationOnDone({ resultNote: secondLine, task: localTask, attemptKey: "run_local_check", queue: [], baseCheck: 'node --test "tests.js"' });
console.log(JSON.stringify({ noCheckCommands: noCheck.commands, localCommands: localCheck.commands, projectPath: localCheck.projectPath }));
"""


class VerificationSchedulingTests(unittest.TestCase):
    def test_static_scheduler_is_exported_and_wired_before_close(self):
        module = ASSISTANT.read_text(encoding="utf-8")
        self.assertIn("export function scheduleVerificationOnDone(", module, "the done-report scheduler is exported")
        self.assertIn("export function focusedTestsForTask(", module, "focused test resolution is exported")
        self.assertIn("export function verificationJobKey(", module, "the per-attempt dedup key is exported")
        self.assertIn("export function findQueuedVerification(", module, "the deduped-retry stamp recovery lookup is exported")
        # Exactly-once: the queue is checked for the key before a job is added.
        self.assertIn('asArray(queue).some((job) => isObject(job) && job.key === key)', module)
        # Only a done claim queues; the result field is read start-anchored.
        self.assertIn("VERIFICATION_RESULT_RE", module)
        # Only an unspecified legacy chooser keeps the npm default. Explicit
        # absence from the project observer remains absent, plus focused tests.
        self.assertIn('baseCheck === undefined ? ["npm run check"]', module)
        self.assertIn('str(baseCheck).trim() ? [str(baseCheck).trim()] : []', module)
        # Spaced Windows paths survive the shell:true runner: every path
        # segment is double-quoted ("Coding projects" was once split by
        # cmd.exe and recorded as "Coding, projects").
        self.assertIn("node --test ${quoted(value)}", module, "focused node commands quote the test path")
        main = MAIN.read_text(encoding="utf-8")
        # Settlement queues the job inside the transaction that marks the card
        # awaiting_verification — before the card can ever close.
        self.assertIn("assistantModule.scheduleVerificationOnDone", main)
        self.assertIn("queue: verificationJobs", main)
        self.assertIn("task.verificationRun", main)
        # A settlement whose queue push survived a rolled-back store write
        # dedupes to null on retry — both settle paths recover the queued job
        # by key so the row still gains its verificationRun stamp.
        self.assertIn("assistantModule.findQueuedVerification", main, "a deduped retry recovers the stamp via the queued job")
        self.assertIn("async function runVerificationJobs(", main, "the queued run is drained after settlement")
        # A done-report burst drains without stacking: bounded parallel jobs and
        # a settle kick that closes the card without waiting for the next pass.
        self.assertIn("const VERIFICATION_PARALLEL = 2", main, "the drain runs a bounded pair of verification jobs")
        self.assertIn("kickVerificationSettlement()", main, "a landed result settles its card immediately")
        # Direct request execution is retired: only tasks settle and are
        # stamped. No settle path keys a job by request identity, and the
        # runner no longer stamps inbox rows.
        self.assertNotIn("agentModes.requestKey(owned)", main, "no request settle path remains")
        self.assertNotIn("agentModes.requestKey(row) !== planned.taskId", main, "the runner stamps task rows only")
        self.assertIn("task?.id !== planned.taskId || task.verificationRun?.key !== planned.key", main, "the runner stamps the task the job was queued for")

    def test_done_report_queues_exactly_one_verification_job(self):
        if not NODE:
            self.skipTest("Node unavailable; static contracts still ran")
        result = _run_driver(DRIVER)
        self.assertEqual(0, result.returncode, result.stderr)
        queued, negatives, quoted, bare, focused, request, recovery, local = (json.loads(line) for line in result.stdout.splitlines())
        # 1–3. One done report, one job; retries and duplicate lines queue none.
        self.assertTrue(queued["queued"], "a done report queues a verification job")
        self.assertEqual(1, queued["queueLength"], f"exactly one job expected: {queued}")
        self.assertFalse(queued["retriedQueued"], "the retried report queues nothing")
        self.assertTrue(queued["secondAttemptQueued"], "a new attempt queues its own job")
        self.assertEqual(1, queued["secondAttemptQueueLength"], "the new attempt queues exactly one job")
        self.assertTrue(queued["distinctKeys"], "attempts never share a dedup key")
        self.assertEqual("npm run check", queued["checkFirst"], "the run starts with npm run check")
        self.assertEqual("verification", queued["kind"])
        self.assertTrue(queued["keyStable"], "the dedup key is stable per attempt")
        # Command fidelity: the task's focused tests ride the same job.
        self.assertEqual(
            ['node --test "tests/foo.test.mjs"',
             'python -m unittest discover -s "tools" -p "test_mefi_studio_tasks.py"'],
            queued["focused"],
            f"focused tests resolved from the task scope: {queued}",
        )
        # 4. failed / partial / missing results queue zero jobs.
        self.assertEqual([False, False, False], negatives["rejectedQueued"])
        self.assertEqual(0, negatives["rejectQueueLength"])
        # 5. Prose quoting the protocol never schedules.
        self.assertTrue(quoted["quotedNull"])
        # 6. No resolvable tests = check only (the run still happens).
        self.assertEqual(["npm run check"], bare["bareCommands"])
        # 7. Focused resolution never invents tests.
        self.assertEqual(2, len(focused["fromScope"]))
        self.assertEqual([], focused["fromNothing"])
        # 8. The scheduler is identity-agnostic: a request-keyed row queues one
        # job with the same command shape and no collision with the task's key.
        self.assertTrue(request["requestQueued"], "a request done report queues a verification job")
        self.assertFalse(request["requestRetryQueued"], "the retried request report queues nothing")
        self.assertEqual(1, request["requestQueueLength"], f"exactly one request job expected: {request}")
        self.assertTrue(request["requestKeyed"], f"the job key is request identity + attempt: {request}")
        self.assertTrue(request["requestTaskId"].startswith(("id:", "request:")), f"the taskId is a request identity: {request}")
        self.assertEqual(["npm run check", 'node --test "tests/foo.test.mjs"'], request["requestCommands"])
        self.assertTrue(request["noTaskCollision"], "request and task keys never share a job")
        # 9. The deduped retry recovers the queued job by its stable key —
        # the partial-commit path that restores a lost verificationRun stamp.
        self.assertTrue(recovery["recoveredIsQueuedJob"], "the recovered job is the attempt's queued job")
        self.assertEqual(queued["key"], recovery["recoveredKey"], "the recovery lookup uses the same key")
        self.assertEqual(["npm run check", 'node --test "tests/foo.test.mjs"', 'python -m unittest discover -s "tools" -p "test_mefi_studio_tasks.py"'], recovery["recoveredCommands"])
        self.assertTrue(recovery["missingNull"], "an attempt that never queued finds nothing")
        self.assertTrue(recovery["notDoneNull"], "a non-done report has no job to recover")
        # 10. Project-local selection survives scheduling without a Studio fallback.
        self.assertEqual([], local["noCheckCommands"])
        self.assertEqual(['node --test "tests.js"'], local["localCommands"])
        self.assertEqual("C:/fixture-game", local["projectPath"])


if __name__ == "__main__":
    unittest.main()
