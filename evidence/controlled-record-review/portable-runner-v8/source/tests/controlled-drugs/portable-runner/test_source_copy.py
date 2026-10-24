"""Tiny synthetic tests only; no subprocesses, network, or full source copies."""
import hashlib
import importlib.util
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('owned_source_copy_under_test', HERE / 'source_copy.py')
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)
PLATFORM_OBSERVATIONS = {}


def metadata(raw):
    return {'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()}


class SourceCopyTests(unittest.TestCase):
    def setUp(self):
        # macOS /var can be a symlink: the tested API deliberately requires a
        # physically opened path, so resolve only this test-owned scratch parent.
        self.temporary = tempfile.TemporaryDirectory(prefix='tiny-source-copy-', dir=Path(tempfile.gettempdir()).resolve())
        self.base = Path(self.temporary.name)
        self.source = self.base / 'source'; self.parent = self.base / 'destination-parent'
        self.source.mkdir(); self.parent.mkdir()
        self.inputs = {'a/one.py': b'one\x00\xff\n', 'b/two.json': b'{"two":2}\n', 'empty': b''}
        for name, raw in self.inputs.items():
            path = self.source / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(raw)
        self.expected = {name: metadata(raw) for name, raw in self.inputs.items()}
        self.destination = self.parent / 'snapshot'

    def tearDown(self):
        # Only this test's own tiny scratch is removed, after retention assertions.
        self.temporary.cleanup()

    def copy(self, **kwargs):
        return c.copy_sources(self.source, self.parent, kwargs.pop('expected', self.expected),
                              kwargs.pop('check', lambda: None), basename=kwargs.pop('basename', 'snapshot'), **kwargs)

    def refusal(self, callback, *, created=False):
        with self.assertRaises(c.SourceCopyError) as caught: callback()
        self.assertEqual(caught.exception.retained_root, str(self.destination) if created else None)
        if created: self.assertTrue(self.destination.exists())
        else: self.assertFalse(self.destination.exists())
        return caught.exception

    def test_exact_bytes_modes_keysets_and_distinct_inodes(self):
        (self.source / 'unlisted').write_text('not admitted, never copied')
        (self.source / 'a/one.py').chmod(0o755)
        receipt = self.copy()
        self.assertTrue(receipt['source_unchanged']); self.assertTrue(receipt['destination_verified'])
        self.assertEqual(receipt['file_count'], 3); self.assertEqual(receipt['directory_count'], 2)
        self.assertEqual(receipt['bytes'], sum(map(len, self.inputs.values())))
        self.assertEqual(stat.S_IMODE(self.destination.stat().st_mode), 0o700)
        self.assertEqual({str(p.relative_to(self.destination)) for p in self.destination.rglob('*') if p.is_file()}, set(self.inputs))
        for name, raw in self.inputs.items():
            p = self.destination / name
            self.assertEqual(p.read_bytes(), raw); self.assertEqual(stat.S_IMODE(p.stat().st_mode), 0o600)
            self.assertNotEqual(p.stat().st_ino, (self.source / name).stat().st_ino)
        self.assertEqual(receipt['authority'], 'caller-supplied-independent-manifest')

    def test_manifest_formal_types_caps_paths_and_collisions(self):
        invalid = [{}, [], {'x': {'bytes': True, 'sha256': '0'*64}}, {'x': {'bytes': -1, 'sha256': '0'*64}},
                   {'x': {'bytes': c.MAX_MEMBER+1, 'sha256': '0'*64}}, {'x': {'bytes': 1, 'sha256': 'A'*64}},
                   {'x': {'bytes': 1, 'sha256': '0'*64, 'extra': 1}}, {'x': metadata(b''), 'x/y': metadata(b'')},
                   {str(i): metadata(b'') for i in range(1025)},
                   {str(i): {'bytes': c.MAX_MEMBER, 'sha256': '0'*64} for i in range(5)}]
        for path in ('../x', '/x', 'a//x', 'a/./x', 'a\\x', 'a\nx', 'tmp/x', '.env', 'a/.env.local', 'a/__pycache__/x', '.git/config', 'a/.npmrc', '.docker/config.json'):
            invalid.append({path: metadata(b'')})
        for value in invalid:
            with self.subTest(value=str(value)[:120]): self.refusal(lambda: self.copy(expected=value))

    def test_published_nested_tmp_is_explicitly_admissible(self):
        key = 'tests/fixtures/history/tmp/old/source.py'; raw = b'old source'
        p = self.source / key; p.parent.mkdir(parents=True); p.write_bytes(raw)
        self.copy(expected={key: metadata(raw)})
        self.assertEqual((self.destination / key).read_bytes(), raw)

    def test_complete_preflight_late_missing_and_bad_hash_create_nothing(self):
        for value in ({**self.expected, 'zmissing': metadata(b'')}, {**self.expected, 'empty': metadata(b'changed')}):
            self.refusal(lambda: self.copy(expected=value))
        self.assertEqual(list(self.parent.iterdir()), [])

    def test_source_fifo_nonblocking_refusal(self):
        p = self.source / 'fifo'; os.mkfifo(p)
        self.refusal(lambda: self.copy(expected={'fifo': metadata(b'')}))

    def test_source_leaf_and_ancestor_symlinks_refused(self):
        (self.source / 'alias').symlink_to(self.source / 'empty')
        self.refusal(lambda: self.copy(expected={'alias': metadata(b'')}))
        (self.source / 'diralias').symlink_to(self.source / 'a', target_is_directory=True)
        self.refusal(lambda: self.copy(expected={'diralias/one.py': self.expected['a/one.py']}))
        link = self.base / 'rootlink'; link.symlink_to(self.source, target_is_directory=True)
        self.refusal(lambda: c.copy_sources(link, self.parent, self.expected, lambda: None, basename='snapshot'))

    def test_source_hardlinks_refused(self):
        os.link(self.source / 'empty', self.source / 'hard')
        self.refusal(lambda: self.copy())

    def test_existing_destination_never_overwritten(self):
        self.destination.mkdir(); marker = self.destination / 'keep'; marker.write_bytes(b'unchanged')
        with self.assertRaises(c.SourceCopyError) as caught: self.copy()
        self.assertIsNone(caught.exception.retained_root)
        self.assertEqual(marker.read_bytes(), b'unchanged'); self.assertEqual(list(self.destination.iterdir()), [marker])

    def test_destination_inside_source_and_unsafe_basename_refused(self):
        for name in ('../bad', 'x/y', '', '.', '_bad'):
            self.refusal(lambda: self.copy(basename=name))
        with self.assertRaises(c.SourceCopyError): c.copy_sources(self.source, self.source, self.expected, lambda: None)

    def test_short_writes_loop_without_duplication_and_chunk_cap(self):
        original = os.write; lengths = []
        def short(fd, data):
            lengths.append(len(data)); return original(fd, data[:2])
        with mock.patch.object(c.os, 'write', short): self.copy()
        self.assertTrue(all(0 < size <= c.CHUNK for size in lengths))
        for name, raw in self.inputs.items(): self.assertEqual((self.destination / name).read_bytes(), raw)

    def test_zero_write_retains_new_tree_and_originals(self):
        with mock.patch.object(c.os, 'write', return_value=0): self.refusal(self.copy, created=True)
        self.assertEqual((self.destination / 'a/one.py').read_bytes(), b'')
        self.assertEqual((self.source / 'a/one.py').read_bytes(), self.inputs['a/one.py'])

    def test_partial_write_failure_retains_exact_prefix(self):
        original = os.write; calls = 0
        def fail(fd, data):
            nonlocal calls
            calls += 1
            if calls == 1: return original(fd, data[:2])
            raise OSError('injected write error')
        with mock.patch.object(c.os, 'write', fail): self.refusal(self.copy, created=True)
        self.assertEqual((self.destination / 'a/one.py').read_bytes(), self.inputs['a/one.py'][:2])

    def test_source_bytes_drift_between_admission_and_copy_refused(self):
        original = c._source; changed = False
        def drift(root, name, value, check, **kwargs):
            nonlocal changed
            if kwargs.get('sink') is not None and not changed:
                changed = True; (self.source / name).write_bytes(b'X' * value['bytes'])
            return original(root, name, value, check, **kwargs)
        with mock.patch.object(c, '_source', drift): self.refusal(self.copy, created=True)

    def test_same_bytes_replacement_inode_after_admission_refused(self):
        original = c._source; changed = False
        def drift(root, name, value, check, **kwargs):
            nonlocal changed
            if kwargs.get('sink') is not None and not changed:
                changed = True; p = self.source / name; p.rename(p.with_name('held-original')); p.write_bytes(self.inputs[name])
            return original(root, name, value, check, **kwargs)
        with mock.patch.object(c, '_source', drift): self.refusal(self.copy, created=True)

    def test_source_directory_same_files_replacement_refused(self):
        original = c._source; changed = False
        def drift(root, name, value, check, **kwargs):
            nonlocal changed
            if kwargs.get('sink') is not None and not changed:
                changed = True; old = self.source / 'a'; old.rename(self.source / 'old-a'); old.mkdir()
                (self.source / 'old-a/one.py').rename(old / 'one.py')
            return original(root, name, value, check, **kwargs)
        with mock.patch.object(c, '_source', drift): self.refusal(self.copy, created=True)

    def test_source_drift_after_copy_detected_final_recheck(self):
        original = c._verify_destination
        def drift(*args):
            original(*args); (self.source / 'a/one.py').write_bytes(b'Z' * len(self.inputs['a/one.py']))
        with mock.patch.object(c, '_verify_destination', drift): self.refusal(self.copy, created=True)

    def test_source_ancestor_swap_never_reads_outside(self):
        outside = self.base / 'outside'; outside.mkdir(); (outside / 'one.py').write_bytes(b'foreign')
        original = c._source; changed = False
        def swap(root, name, value, check, **kwargs):
            nonlocal changed
            if kwargs.get('sink') is not None and not changed:
                changed = True; (self.source / 'a').rename(self.source / 'held-a'); (self.source / 'a').symlink_to(outside, target_is_directory=True)
            return original(root, name, value, check, **kwargs)
        with mock.patch.object(c, '_source', swap): self.refusal(self.copy, created=True)
        self.assertEqual((outside / 'one.py').read_bytes(), b'foreign')
        self.assertEqual((self.destination / 'a/one.py').read_bytes(), b'')

    def test_destination_ancestor_swap_writes_only_held_tree_then_refuses(self):
        outside = self.base / 'outside'; outside.mkdir(); held = self.base / 'held-parent'
        original = os.write; changed = False
        def swap(fd, data):
            nonlocal changed
            if not changed:
                changed = True; self.parent.rename(held); self.parent.symlink_to(outside, target_is_directory=True)
            return original(fd, data)
        with mock.patch.object(c.os, 'write', swap):
            with self.assertRaises(c.SourceCopyError) as caught: self.copy()
        self.assertEqual(caught.exception.retained_root, str(self.destination))
        self.assertEqual(list(outside.iterdir()), [])
        self.assertEqual((held / 'snapshot/a/one.py').read_bytes(), self.inputs['a/one.py'])

    def test_created_root_replacement_refused_before_copy(self):
        changed = False; held = self.parent / 'held'
        def check():
            nonlocal changed
            if self.destination.exists() and not changed:
                changed = True; self.destination.rename(held); self.destination.mkdir(mode=0o700)
        self.refusal(lambda: self.copy(check=check), created=True)
        self.assertEqual(list(self.destination.iterdir()), []); self.assertEqual(list(held.iterdir()), [])

    def test_destination_extra_file_or_directory_refused(self):
        original = c._verify_destination
        def add(*args):
            (self.destination / 'extra').write_bytes(b'x'); return original(*args)
        with mock.patch.object(c, '_verify_destination', add): self.refusal(self.copy, created=True)

    def test_destination_extra_directory_refused(self):
        original = c._verify_destination
        def add(*args):
            (self.destination / 'extra-directory').mkdir(mode=0o700); return original(*args)
        with mock.patch.object(c, '_verify_destination', add): self.refusal(self.copy, created=True)

    def test_destination_symlink_refused(self):
        original = c._verify_destination
        def add(*args):
            p = self.destination / 'empty'; p.unlink(); p.symlink_to(self.source / 'empty'); return original(*args)
        with mock.patch.object(c, '_verify_destination', add): self.refusal(self.copy, created=True)

    def test_destination_hardlink_refused(self):
        original = c._verify_destination
        def add(*args):
            os.link(self.destination / 'empty', self.destination / 'alias'); return original(*args)
        with mock.patch.object(c, '_verify_destination', add): self.refusal(self.copy, created=True)

    def test_destination_inode_substitution_refused(self):
        original = c._verify_destination
        def replace(*args):
            p = self.destination / 'a/one.py'; p.rename(self.destination / 'held'); p.write_bytes(self.inputs['a/one.py']); p.chmod(0o600)
            return original(*args)
        with mock.patch.object(c, '_verify_destination', replace): self.refusal(self.copy, created=True)

    def test_deadline_before_creation_and_after_partial_write(self):
        def expired(): raise TimeoutError('original cutoff')
        self.refusal(lambda: self.copy(check=expired))
        wrote = False; original = os.write
        def write(fd, data):
            nonlocal wrote
            result = original(fd, data); wrote = True; return result
        def check():
            if wrote: raise TimeoutError('original cutoff')
        with mock.patch.object(c.os, 'write', write): self.refusal(lambda: self.copy(check=check), created=True)
        self.assertEqual((self.destination / 'a/one.py').read_bytes(), self.inputs['a/one.py'])

    def test_terminal_deadline_after_descriptor_close_never_returns_success(self):
        original = c.PhysicalRoot.close; closed = 0
        def close(obj):
            nonlocal closed
            original(obj); closed += 1
        def check():
            if closed >= 3: raise TimeoutError('terminal cutoff')
        with mock.patch.object(c.PhysicalRoot, 'close', close): self.refusal(lambda: self.copy(check=check), created=True)

    def test_destination_leaf_swap_between_stat_and_hash_refused(self):
        original = c._source; changed = False
        def swap(root, name, value, check, **kwargs):
            nonlocal changed
            if root.path == self.destination and not changed:
                changed = True; p = self.destination / name
                p.rename(self.destination / 'retained-file'); p.write_bytes(self.inputs[name]); p.chmod(0o600)
            return original(root, name, value, check, **kwargs)
        with mock.patch.object(c, '_source', swap): self.refusal(self.copy, created=True)

    def test_destination_changes_during_original_recheck_refused(self):
        original = c._source; changed = False
        def swap(root, name, value, check, **kwargs):
            nonlocal changed
            if root.path == self.source and kwargs.get('expected_identity') and kwargs.get('sink') is None and not changed:
                changed = True; (self.destination / 'a/one.py').write_bytes(b'corruption')
            return original(root, name, value, check, **kwargs)
        with mock.patch.object(c, '_source', swap): self.refusal(self.copy, created=True)

    def test_destination_directory_replacement_refused_before_file_creation(self):
        changed = False
        def check():
            nonlocal changed
            if (self.destination / 'b').exists() and not changed:
                changed = True; (self.destination / 'a').rename(self.destination / 'held-a'); (self.destination / 'a').mkdir(mode=0o700)
        self.refusal(lambda: self.copy(check=check), created=True)
        self.assertEqual(list((self.destination / 'a').iterdir()), [])
        self.assertEqual(list((self.destination / 'held-a').iterdir()), [])

    def test_new_file_collision_never_overwrites_foreign_bytes(self):
        changed = False
        def check():
            nonlocal changed
            if (self.destination / 'b').exists() and not changed:
                changed = True; (self.destination / 'a/one.py').write_bytes(b'foreign')
        self.refusal(lambda: self.copy(check=check), created=True)
        self.assertEqual((self.destination / 'a/one.py').read_bytes(), b'foreign')

    def test_multi_chunk_read_and_write_bounds(self):
        raw = b'x' * (c.CHUNK + 3); (self.source / 'larger').write_bytes(raw)
        original_read, original_write = os.read, os.write; reads = []; writes = []
        def read(fd, size):
            reads.append(size); return original_read(fd, size)
        def write(fd, data):
            writes.append(len(data)); return original_write(fd, data)
        with mock.patch.object(c.os, 'read', read), mock.patch.object(c.os, 'write', write):
            self.copy(expected={'larger': metadata(raw)})
        self.assertEqual((self.destination / 'larger').read_bytes(), raw)
        self.assertTrue(all(0 < size <= c.CHUNK for size in reads + writes))
        self.assertEqual(writes, [c.CHUNK, 3])

    def test_primary_write_error_survives_descriptor_close_failure(self):
        original_close = os.close; writing = False; closed_failed = False
        def write(fd, data):
            nonlocal writing
            writing = True; raise OSError('primary write failure')
        def close(fd):
            nonlocal closed_failed
            original_close(fd)
            if writing and not closed_failed:
                closed_failed = True; raise OSError('secondary close failure')
        with mock.patch.object(c.os, 'write', write), mock.patch.object(c.os, 'close', close):
            error = self.refusal(self.copy, created=True)
        self.assertEqual(str(error.__cause__), 'primary write failure')
        self.assertTrue(any('close also failed' in note for note in error.__cause__.__notes__))

    def test_double_leading_slash_source_and_parent_refuse_before_mkdir(self):
        for source, parent in (('//' + str(self.source).lstrip('/'), str(self.parent)),
                               (str(self.source), '//' + str(self.source).lstrip('/'))):
            before = set(self.source.iterdir())
            with self.assertRaises(c.SourceCopyError) as caught:
                c.copy_sources(source, parent, self.expected, lambda: None, basename='snapshot')
            self.assertIsNone(caught.exception.retained_root)
            self.assertEqual(caught.exception.phase, 'manifest-admission')
            self.assertEqual(set(self.source.iterdir()), before)
            self.assertFalse((self.source / 'snapshot').exists())

    def test_actual_case_alias_same_root_refuses_before_mkdir(self):
        alias = self.source.with_name('SOURCE')
        available = alias.exists() and os.path.samefile(alias, self.source)
        PLATFORM_OBSERVATIONS['same_root_case_alias_available'] = available
        if not available:
            PLATFORM_OBSERVATIONS['case_alias_unavailable_reason'] = 'Filesystem does not expose SOURCE as the same physical source directory; portable ancestor-identity tests still execute.'
            return
        before = set(self.source.iterdir())
        with self.assertRaises(c.SourceCopyError) as caught:
            c.copy_sources(self.source, alias, self.expected, lambda: None, basename='snapshot')
        self.assertIsNone(caught.exception.retained_root)
        self.assertIn('physically inside source', str(caught.exception.__cause__))
        self.assertEqual(set(self.source.iterdir()), before)

    def test_actual_case_alias_nested_parent_refuses_before_mkdir(self):
        nested = self.source / 'nested'; nested.mkdir()
        alias = self.source.with_name('SOURCE') / 'nested'
        available = alias.exists() and os.path.samefile(alias, nested)
        PLATFORM_OBSERVATIONS['nested_case_alias_available'] = available
        if not available: return
        with self.assertRaises(c.SourceCopyError) as caught:
            c.copy_sources(self.source, alias, self.expected, lambda: None, basename='snapshot')
        self.assertIsNone(caught.exception.retained_root)
        self.assertIn('physically inside source', str(caught.exception.__cause__))
        self.assertEqual(list(nested.iterdir()), [])

    def test_portable_physical_identity_checks_every_parent_ancestor(self):
        source = SimpleNamespace(identity=(5, 17, stat.S_IFDIR | 0o700), verify=lambda: None)
        parent = SimpleNamespace(descriptors=[11, 12, 13, 14], verify=lambda: None, check=lambda: None)
        for matching_descriptor in parent.descriptors:
            visited = []
            def fstat(fd):
                visited.append(fd)
                return SimpleNamespace(st_dev=5, st_ino=17 if fd == matching_descriptor else 200 + fd)
            with mock.patch.object(c.os, 'fstat', fstat), self.assertRaisesRegex(ValueError, 'physically inside source'):
                c._assert_outside_source(source, parent)
            self.assertEqual(visited, parent.descriptors[:parent.descriptors.index(matching_descriptor)+1])
        # An equal inode number on a different device is not the same directory.
        with mock.patch.object(c.os, 'fstat', lambda fd: SimpleNamespace(st_dev=6, st_ino=17)):
            c._assert_outside_source(source, parent)

    def test_genuinely_outside_parent_passes_physical_ancestry_admission(self):
        source = c.PhysicalRoot(self.source, lambda: None)
        parent = c.PhysicalRoot(self.parent, lambda: None)
        try: c._assert_outside_source(source, parent)
        finally: source.close(); parent.close()
        receipt = self.copy()
        self.assertTrue(receipt['source_unchanged']); self.assertTrue(receipt['destination_verified'])
        self.assertFalse((self.source / 'snapshot').exists())

    def test_close_error_is_failure_and_primary_write_error_preserved(self):
        original = os.close; injected = False
        def close(fd):
            nonlocal injected
            original(fd)
            if not injected: injected = True; raise OSError('close after actual close')
        with mock.patch.object(c.os, 'close', close): self.refusal(self.copy)
        self.assertFalse(self.destination.exists())


if __name__ == '__main__':
    unittest.main()
