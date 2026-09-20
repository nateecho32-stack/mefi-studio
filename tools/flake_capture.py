"""Shared flake-capture helper for the Python suite.

The suite audits a live tree that parallel Studio agent runs edit
concurrently, so a check that reads repo state can observe a transient
mid-edit state: it fails once, then passes on immediate re-run (the
one-shot "203 tests, failures=1" flake). Tests guard such live-state
checks with the retry helper in ``test_mefi_studio_auditor.py``; this
module records the evidence, so the next occurrence names itself and
pins its fixture instead of vanishing into a green re-run.

Captures are appended to ``data/python-flake-capture.jsonl`` — local
state only, never committed (only curated.json/models.json belong in
Git). Logging must never break the suite, so ``record`` swallows
write errors.
"""
from __future__ import annotations

import json
import time
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
LOG = ROOT / "data" / "python-flake-capture.jsonl"


def record(test_id, first_error, detail=""):
    """Append one captured transient failure to the local capture log."""
    entry = {
        "at": int(time.time() * 1000),
        "test": test_id,
        "firstError": str(first_error)[:2000],
        "detail": detail,
    }
    try:
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except OSError:
        pass
    print(f"FLAKE-CAPTURED {test_id}: {str(first_error)[:300]} ({detail})")


def retry_transient(probe, test_id, detail="", settle_seconds=1.0):
    """Run ``probe``; a failure that clears on immediate re-run is a
    concurrent-edit flake: record it and raise SkipTest. A failure that
    reproduces is real — re-raise the original so the gate keeps failing."""
    try:
        return probe()
    except (AssertionError, ValueError) as first:
        time.sleep(settle_seconds)
        try:
            probe()
        except (AssertionError, ValueError):
            raise first
        record(test_id, first, detail)
        raise unittest.SkipTest(
            f"transient live-tree flake captured for {test_id}; re-run passed ({detail})"
        )
