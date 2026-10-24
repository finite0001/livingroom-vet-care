"""Tiny retained fixtures; no child, network, source tree copy or target import."""
import hashlib
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('portable_output_observer', Path(__file__).with_name('output_observer.py'))
observer = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = observer
SPEC.loader.exec_module(observer)


class OutputObserverTests(unittest.TestCase):
    def setUp(self):
        self.base = Path(tempfile.mkdtemp(prefix='lrv-output-observer-')).resolve()
        self.root = self.base / 'output'
        self.root.mkdir(mode=0o700)
        self.names = {k: k + ('.log' if k in ('stdout', 'stderr') else '.json') for k in observer.SLOTS}
        self.held = None

    def tearDown(self):
        if self.held is not None and not self.held.closed:
            self.held.close()

    def hold(self, **kwargs):
        args = dict(deadline=time.monotonic() + 30, check=lambda: None)
        args.update(kwargs)
        self.held = observer.HeldOutput(str(self.root), self.names, **args)
        return self.held

    def write(self):
        for slot, name in self.names.items():
            fd = os.open(self.root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            try:
                os.write(fd, b'' if slot in ('stdout', 'stderr') else b'{}')
            finally:
                os.close(fd)

    def test_exact_five_records_and_empty_streams(self):
        held = self.hold()
        self.write()
        values = held.observe()
        self.assertEqual(tuple(v.name for v in values), observer.SLOTS)
        self.assertEqual(tuple(v.size for v in values), (2, 0, 0, 2, 2))
        self.assertEqual(values[0].sha256, hashlib.sha256(b'{}').hexdigest())
        self.assertEqual(values[0].raw, b'{}')
        self.assertIsNone(values[1].raw)
        self.assertEqual(held.observe(), values)

    def test_names_are_detached_from_input(self):
        held = self.hold()
        self.write()
        self.names['job'] = 'elsewhere.json'
        self.assertEqual(held.observe()[0].size, 2)

    def test_existing_slot_refuses_before_launch(self):
        (self.root / 'job.json').write_bytes(b'x')
        with self.assertRaisesRegex(ValueError, 'absent'):
            self.hold()

    def test_dangling_slot_refuses_before_launch(self):
        (self.root / 'guard.json').symlink_to('missing')
        with self.assertRaisesRegex(ValueError, 'absent'):
            self.hold()

    def test_duplicate_names_refuse(self):
        self.names['guard'] = self.names['job']
        with self.assertRaisesRegex(ValueError, 'distinct'):
            self.hold()

    def test_extra_slot_refuses(self):
        self.names['extra'] = 'extra.log'
        with self.assertRaisesRegex(ValueError, 'five'):
            self.hold()

    def test_nonphysical_ancestor_refuses(self):
        alias = self.base / 'alias'
        alias.symlink_to(self.root, target_is_directory=True)
        with self.assertRaises(OSError):
            observer.HeldOutput(str(alias), self.names, deadline=time.monotonic()+30, check=lambda: None)

    def test_nonprivate_directory_refuses(self):
        self.root.chmod(0o755)
        with self.assertRaisesRegex(ValueError, '0700'):
            self.hold()

    def test_invalid_deadlines_refuse(self):
        for deadline in (True, float('nan'), float('inf'), 0, time.monotonic()+700):
            with self.subTest(deadline=deadline), self.assertRaises(ValueError):
                self.hold(deadline=deadline)

    def test_missing_file_poison_is_sticky(self):
        held = self.hold()
        with self.assertRaises(FileNotFoundError):
            held.observe()
        self.write()
        with self.assertRaisesRegex(ValueError, 'failed'):
            held.observe()

    def test_empty_terminal_refuses(self):
        held = self.hold()
        self.write()
        (self.root / 'terminal.json').write_bytes(b'')
        with self.assertRaisesRegex(ValueError, 'regular slot'):
            held.observe()

    def test_nonprivate_file_refuses(self):
        held = self.hold()
        self.write()
        (self.root / 'guard.json').chmod(0o644)
        with self.assertRaisesRegex(ValueError, 'regular slot'):
            held.observe()

    def test_hardlink_refuses(self):
        held = self.hold()
        self.write()
        os.link(self.root / 'job.json', self.base / 'retained-job')
        with self.assertRaisesRegex(ValueError, 'regular slot'):
            held.observe()

    def test_symlink_refuses(self):
        held = self.hold()
        self.write()
        (self.root / 'job.json').rename(self.base / 'retained-job')
        (self.root / 'job.json').symlink_to(self.base / 'retained-job')
        with self.assertRaises(OSError):
            held.observe()

    def test_fifo_refuses_without_blocking(self):
        held = self.hold()
        self.write()
        (self.root / 'job.json').rename(self.base / 'retained-job')
        os.mkfifo(self.root / 'job.json', 0o600)
        with self.assertRaisesRegex(ValueError, 'regular slot'):
            held.observe()

    def test_oversized_sparse_file_refuses(self):
        held = self.hold()
        self.write()
        with (self.root / 'stdout.log').open('r+b') as handle:
            handle.truncate(observer.MAX_BYTES + 1)
        with self.assertRaisesRegex(ValueError, 'regular slot'):
            held.observe()

    def test_root_replacement_refuses(self):
        held = self.hold()
        self.write()
        self.root.rename(self.base / 'retained-root')
        self.root.mkdir(mode=0o700)
        with self.assertRaisesRegex(ValueError, 'ancestry'):
            held.observe()

    def test_mutation_of_earlier_slot_refuses(self):
        held = self.hold()
        self.write()
        original = held._read
        def mutate(slot, name):
            result = original(slot, name)
            if slot == 'guard':
                (self.root / 'job.json').write_bytes(b'[]')
            return result
        with patch.object(held, '_read', side_effect=mutate), self.assertRaisesRegex(ValueError, 'earlier'):
            held.observe()

    def test_mutation_during_read_refuses(self):
        held = self.hold()
        self.write()
        original = os.read
        changed = False
        def read(fd, size):
            nonlocal changed
            result = original(fd, size)
            if result and not changed:
                changed = True
                (self.root / 'job.json').write_bytes(b'[]')
            return result
        with patch.object(observer.os, 'read', side_effect=read), self.assertRaisesRegex(ValueError, 'changed'):
            held.observe()

    def test_parent_check_failure_is_sticky(self):
        held = self.hold()
        self.write()
        with patch.object(held, 'parent_check', side_effect=RuntimeError('capacity')):
            with self.assertRaisesRegex(RuntimeError, 'capacity'):
                held.observe()
        with self.assertRaisesRegex(ValueError, 'failed'):
            held.observe()

    def test_deadline_expires_inside_parent_check(self):
        held = self.hold()
        self.write()
        clock = [held.deadline-1]
        def expire():
            clock[0] = held.deadline
        with patch.object(observer.time, 'monotonic', side_effect=lambda: clock[0]), patch.object(held, 'parent_check', side_effect=expire):
            with self.assertRaises(TimeoutError):
                held.observe()

    def test_close_attempts_all_descriptors_once(self):
        held = self.hold()
        expected = list(reversed(held.fds))
        seen = []
        original = os.close
        def close(fd):
            seen.append(fd)
            original(fd)
            if len(seen) == 1:
                raise OSError('late close error')
        with patch.object(observer.os, 'close', side_effect=close), self.assertRaises(OSError):
            held.close()
        self.assertEqual(seen, expected)
        held.close()
        self.assertEqual(held.fds, [])

    def test_leaf_close_error_poison_is_sticky(self):
        held = self.hold()
        self.write()
        original = os.close
        def close(fd):
            original(fd)
            raise OSError('leaf close')
        with patch.object(observer.os, 'close', side_effect=close), self.assertRaises(OSError):
            held.observe()
        with self.assertRaisesRegex(ValueError, 'failed'):
            held.observe()

    def test_close_deadline_refuses_after_all_descriptors_closed(self):
        held = self.hold()
        with patch.object(observer.time, 'monotonic', return_value=held.deadline), self.assertRaises(TimeoutError):
            held.close()
        self.assertEqual(held.fds, [])
        self.assertTrue(held.closed)


if __name__ == '__main__':
    unittest.main()
