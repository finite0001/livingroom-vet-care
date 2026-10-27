"""Inert late-failure controls. These never establish database acceptance."""
from contextlib import contextmanager
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import install_rehearsal as rehearsal


class FinalFrameTests(unittest.TestCase):
    def exercise(self, *, execute_error=False, cleanup_error=False, prefix_error=False, elapsed=1):
        with tempfile.TemporaryDirectory(prefix="lrv-frame-control-") as directory:
            folder = Path(directory).resolve()

            class InertInstallation:
                def __init__(self, view, evidence, layout, started):
                    self.evidence = evidence
                    self.result = {"kind": "inert-unit-control", "passed": False}

                def execute(self):
                    if execute_error:
                        raise ValueError("inert execution failure")

                def cleanup(self):
                    if cleanup_error:
                        raise RuntimeError("inert cleanup failure")
                    self.result["normal_owned_cleanup"] = True

                save = rehearsal.Installation.save

            @contextmanager
            def materialize():
                yield folder, {}
                if prefix_error:
                    raise ValueError("inert late copied-source failure")

            with patch.object(rehearsal.sys, "argv", ["unit", "--run-synthetic-local"]), \
                 patch.object(rehearsal, "source_admission", return_value=({}, {}, {})), \
                 patch.object(rehearsal, "Installation", InertInstallation), \
                 patch.object(rehearsal.prefix, "materialize", materialize), \
                 patch.object(rehearsal.prefix, "verify_sources"), \
                 patch.object(rehearsal.tempfile, "mkdtemp", return_value=str(folder)), \
                 patch.object(rehearsal.shutil, "disk_usage", return_value=SimpleNamespace(free=8 * 1024 ** 3)), \
                 patch.object(rehearsal.time, "monotonic", side_effect=[0, elapsed]):
                with self.assertRaises(BaseException) as caught:
                    rehearsal.main()
            result = json.loads((folder / "result.json").read_text())
            self.assertIs(result["passed"], False)
            return caught.exception, result

    def test_prefix_exit_failure_cannot_leave_a_successful_result(self):
        error, result = self.exercise(prefix_error=True)
        self.assertIsInstance(error, ValueError)
        self.assertTrue(result["normal_owned_cleanup"])

    def test_primary_and_cleanup_errors_are_both_retained(self):
        error, result = self.exercise(execute_error=True, cleanup_error=True)
        self.assertIsInstance(error, BaseExceptionGroup)
        self.assertEqual(len(error.exceptions), 2)
        self.assertTrue(result["cleanup_failed"])

    def test_late_whole_budget_failure_is_not_accepted(self):
        error, result = self.exercise(elapsed=600)
        self.assertIsInstance(error, TimeoutError)
        self.assertEqual(result["elapsed_seconds"], 600)


if __name__ == "__main__":
    unittest.main()
