"""Binary integrity, file ownership, failure and owned-process cleanup controls."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import bounded_archive as archive


class ArchiveTests(unittest.TestCase):
    def command(self, code):
        return [sys.executable, '-I', '-B', '-c', code]

    def test_binary_roundtrip_uses_exact_verified_bytes(self):
        raw = bytes(range(256)) * 300
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'backup.dump'
            item = archive.capture(self.command('import os;os.write(1,bytes(range(256))*300)'), target, timeout=10)
            try:
                self.assertEqual(item.sha256, hashlib.sha256(raw).hexdigest())
                self.assertEqual(item.length, len(raw))
                self.assertEqual(target.stat().st_mode & 0o777, 0o600)
                code = 'import sys;raw=sys.stdin.buffer.read();assert raw==bytes(range(256))*300'
                self.assertEqual(item.restore(self.command(code), timeout=10)['bytes'], len(raw))
            finally:
                item.close()

    def test_modified_or_replaced_archive_refuses_before_child(self):
        with tempfile.TemporaryDirectory() as directory:
            target, marker = Path(directory) / 'backup.dump', Path(directory) / 'started'
            item = archive.capture(self.command('print("abc",end="")'), target, timeout=10)
            try:
                target.write_bytes(b'xyz')
                code = 'from pathlib import Path;Path(' + repr(str(marker)) + ').touch()'
                with self.assertRaisesRegex(ValueError, 'hash differs'):
                    item.restore(self.command(code), timeout=10)
                self.assertFalse(marker.exists())
                target.unlink()
                target.write_bytes(b'abc')
                target.chmod(0o600)
                with self.assertRaisesRegex(ValueError, 'identity|private regular'):
                    item.restore(self.command(code), timeout=10)
                self.assertFalse(marker.exists())
            finally:
                item.close()

    def test_symlink_and_existing_file_are_never_overwritten(self):
        with tempfile.TemporaryDirectory() as directory:
            original, link = Path(directory) / 'original', Path(directory) / 'link'
            original.write_bytes(b'preserve')
            link.symlink_to(original)
            for target in (original, link):
                with self.assertRaises(FileExistsError):
                    archive.capture(self.command('print("bad")'), target, timeout=10)
            self.assertEqual(original.read_bytes(), b'preserve')

    def test_nonzero_empty_and_stderr_leave_no_archive(self):
        cases = [('import os;os.write(1,b"partial");raise SystemExit(7)', subprocess.CalledProcessError),
                 ('pass', ValueError), ('import sys;print("x");print("warning",file=sys.stderr)', ValueError)]
        with tempfile.TemporaryDirectory() as directory:
            for index, (code, error) in enumerate(cases):
                target = Path(directory) / str(index)
                with self.assertRaises(error):
                    archive.capture(self.command(code), target, timeout=10)
                self.assertFalse(target.exists())

    def test_overflow_is_refusal_without_partial_file(self):
        previous = archive.ARCHIVE_CAP
        archive.ARCHIVE_CAP = 64
        try:
            with tempfile.TemporaryDirectory() as directory:
                target = Path(directory) / 'dump'
                with self.assertRaisesRegex(ValueError, 'byte contract'):
                    archive.capture(self.command('import os;os.write(1,b"x"*65)'), target, timeout=10)
                self.assertFalse(target.exists())
        finally:
            archive.ARCHIVE_CAP = previous

    def test_early_consumer_exit_is_refused(self):
        with tempfile.TemporaryDirectory() as directory:
            item = archive.capture(self.command('import os;os.write(1,b"x"*1000000)'), Path(directory) / 'dump', timeout=10)
            try:
                with self.assertRaises((ValueError, subprocess.CalledProcessError)):
                    item.restore(self.command('raise SystemExit(4)'), timeout=10)
            finally:
                item.close()

    def test_file_mutation_after_verification_cannot_change_sent_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / 'dump'
            item = archive.capture(self.command('print("original",end="")'), target, timeout=10)
            original = item._verified_bytes
            def mutate_after_read(deadline):
                verified = original(deadline)
                target.write_bytes(b'modified')
                return verified
            try:
                with patch.object(item, '_verified_bytes', mutate_after_read):
                    item.restore(self.command('import sys;assert sys.stdin.buffer.read()==b"original"'), timeout=10)
            finally:
                item.close()

    def test_verification_cannot_renew_consumer_deadline(self):
        with tempfile.TemporaryDirectory() as directory:
            target, marker = Path(directory) / 'dump', Path(directory) / 'started'
            item = archive.capture(self.command('print("original",end="")'), target, timeout=10)
            original = item._verified_bytes
            def slow_verification(deadline):
                verified = original(deadline)
                time.sleep(0.1)
                return verified
            code = 'from pathlib import Path;Path(' + repr(str(marker)) + ').touch()'
            try:
                with patch.object(item, '_verified_bytes', slow_verification):
                    with self.assertRaises(TimeoutError):
                        item.restore(self.command(code), timeout=0.05)
                self.assertFalse(marker.exists())
            finally:
                item.close()

    def test_timeout_stops_descendant_after_leader_exit(self):
        with tempfile.TemporaryDirectory() as directory:
            marker, target = Path(directory) / 'escaped', Path(directory) / 'dump'
            child = 'import time;from pathlib import Path;time.sleep(2);Path(' + repr(str(marker)) + ').touch()'
            parent = 'import subprocess,sys;subprocess.Popen([sys.executable,"-I","-B","-c",' + repr(child) + ']);print("started",flush=True)'
            with self.assertRaises(TimeoutError):
                archive.capture(self.command(parent), target, timeout=1)
            time.sleep(2.1)
            self.assertFalse(marker.exists())
            self.assertFalse(target.exists())

    def test_completed_leader_cannot_leave_descendant_with_closed_pipes(self):
        with tempfile.TemporaryDirectory() as directory:
            for exit_code in (0, 7):
                marker, target = Path(directory) / ('escaped-' + str(exit_code)), Path(directory) / ('dump-' + str(exit_code))
                child = 'import time;from pathlib import Path;time.sleep(1);Path(' + repr(str(marker)) + ').touch()'
                code = ('import subprocess,sys;subprocess.Popen([sys.executable,"-I","-B","-c",' + repr(child)
                        + '],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL);'
                        + 'print("archive",flush=True);raise SystemExit(' + str(exit_code) + ')')
                if exit_code:
                    with self.assertRaises(subprocess.CalledProcessError):
                        archive.capture(self.command(code), target, timeout=10)
                    self.assertFalse(target.exists())
                else:
                    item = archive.capture(self.command(code), target, timeout=10)
                    item.close()
                time.sleep(1.1)
                self.assertFalse(marker.exists())


if __name__ == '__main__':
    unittest.main()
