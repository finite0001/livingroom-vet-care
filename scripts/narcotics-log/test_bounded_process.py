"""Exercise real pipe pressure, exact limits, refusal and child cleanup."""
import os
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

import bounded_process as transport


class BoundedProcessTests(unittest.TestCase):
    def child(self, code, **kwargs):
        return transport.run([sys.executable, "-I", "-B", "-c", code], timeout=30, **kwargs)

    def test_duplex_large_input_and_stderr_do_not_deadlock(self):
        text = "a\u00e5" * 100000
        code = "import sys;sys.stderr.write('e'*200000);sys.stderr.flush();sys.stdout.write(sys.stdin.read())"
        result = self.child(code, input=text, stdout_cap=len(text.encode()), stderr_cap=200000)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, text)
        self.assertEqual(result.stderr, "e" * 200000)

    def test_exact_cap_succeeds_and_one_more_byte_refuses(self):
        self.assertEqual(self.child("print('a'*64,end='')", stdout_cap=64).stdout, "a" * 64)
        with self.assertRaises(transport.ProcessOutputLimit) as caught:
            self.child("print('a'*65,end='')", stdout_cap=64)
        self.assertEqual(caught.exception.stdout, b"a" * 65)

    def test_stderr_has_its_own_limit_and_invalid_encoding_is_retained(self):
        with self.assertRaises(transport.ProcessOutputLimit):
            self.child("import sys;sys.stderr.write('x'*65)", stderr_cap=64)
        with self.assertRaises(transport.ProcessEncodingError) as caught:
            self.child("import os;os.write(1,b'\\xff')")
        self.assertEqual(caught.exception.stdout, b"\xff")

    def test_nonzero_exit_is_never_reclassified_as_success(self):
        result = self.child("import sys;print('no');sys.exit(7)")
        self.assertEqual(result.returncode, 7)
        with self.assertRaises(subprocess.CalledProcessError) as caught:
            self.child("import sys;sys.exit(7)", check=True)
        self.assertEqual(caught.exception.returncode, 7)

    def test_timeout_kills_the_owned_process_group(self):
        code = "import os,time;print(os.getpid(),flush=True);time.sleep(20)"
        with self.assertRaises(subprocess.TimeoutExpired) as caught:
            transport.run([sys.executable, "-I", "-B", "-c", code], timeout=0.5)
        # A severely loaded host may time out before the interpreter starts.
        # If it printed its PID, that exact owned process must already be gone.
        if caught.exception.output:
            pid = int(caught.exception.output.strip())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)

    def test_invalid_contract_refuses_before_any_child_is_started(self):
        for kwargs in ({"stdout_cap": True}, {"stderr_cap": -1}, {"capture_output": False}, {"text": False}):
            with self.assertRaises(ValueError):
                self.child("raise SystemExit('must not start')", **kwargs)
        for timeout in (True, 0, float("inf"), 601):
            with self.assertRaises(ValueError):
                transport.run([sys.executable, "-I", "-B", "-c", "pass"], timeout=timeout)

    def test_timeout_also_stops_child_when_the_leader_has_already_exited(self):
        with tempfile.TemporaryDirectory(prefix="lrv-process-cleanup-") as directory:
            marker = Path(directory) / "escaped-child"
            child = "import pathlib,sys,time;time.sleep(2);pathlib.Path(sys.argv[1]).write_text('escaped')"
            parent = ("import subprocess,sys;c=subprocess.Popen([sys.executable,'-I','-B','-c',"
                      + repr(child) + "," + repr(str(marker)) + "]);print(c.pid,flush=True)")
            with self.assertRaises(subprocess.TimeoutExpired) as caught:
                transport.run([sys.executable, "-I", "-B", "-c", parent], timeout=1)
            self.assertTrue(caught.exception.output.strip().isdigit(), "The child must actually have started")
            time.sleep(2.2)
            self.assertFalse(marker.exists(), "The descendant escaped the owned process group cleanup")


if __name__ == "__main__":
    unittest.main()
