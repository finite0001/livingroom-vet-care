"""Deterministic timing regression tests; no database or provider calls."""
import ast
import io
from pathlib import Path
from types import SimpleNamespace
import unittest
import uuid


class ContentionTimingTest(unittest.TestCase):
    def exercise(self, observe_waiter=True):
        clock = SimpleNamespace(now=0.0)
        events = []
        processes = []

        class Process:
            def __init__(self, *args, **kwargs):
                self.stdin = io.StringIO()
                self.stderr = io.StringIO()
                self.returncode = 0
                processes.append(self)
                if len(processes) == 2:
                    clock.now += .75

            def poll(self):
                return None

            def communicate(self, timeout):
                assert timeout == 10
                events.append("completed")
                return "result", ""

        def sql(query):
            if "idle in transaction" in query:
                clock.now += 7.5
                events.append("holder observed")
                return SimpleNamespace(stdout="1")
            self.assertIn("pg_blocking_pids", query)
            if observe_waiter:
                events.append("waiter observed")
            return SimpleNamespace(stdout="1" if observe_waiter else "0")

        def sleep(seconds):
            clock.now += seconds

        def check(condition, message):
            self.assertTrue(condition, message)

        source = Path(__file__).with_name("ezyvet_attachment_originals_concurrency.py")
        function = next(node for node in ast.parse(source.read_text()).body
                        if isinstance(node, ast.FunctionDef) and node.name == "contended")
        namespace = dict(uuid=uuid, owned_sessions=[], COMMAND=[], sql=sql, check=check,
                         subprocess=SimpleNamespace(Popen=Process, PIPE=-1),
                         time=SimpleNamespace(monotonic=lambda: clock.now, sleep=sleep))
        exec(compile(ast.Module(body=[function], type_ignores=[]), str(source), "exec"), namespace)
        try:
            namespace["contended"]("hold", "wait", lambda code, out, err: code == 0 and out == "result",
                                   during_wait=lambda: events.append("authorization changed"))
        finally:
            self.events = events
            self.elapsed = clock.now
        return events

    def test_slow_holder_does_not_consume_waiter_budget(self):
        self.assertEqual(self.exercise(), ["holder observed", "waiter observed",
                                          "authorization changed", "completed", "completed"])
        self.assertGreater(self.elapsed, 8)

    def test_missing_lock_wait_still_fails_without_authorization_change(self):
        with self.assertRaisesRegex(AssertionError, "actually waits"):
            self.exercise(observe_waiter=False)
        self.assertNotIn("authorization changed", self.events)
        self.assertGreaterEqual(self.elapsed, 16.25)


if __name__ == "__main__":
    unittest.main()
