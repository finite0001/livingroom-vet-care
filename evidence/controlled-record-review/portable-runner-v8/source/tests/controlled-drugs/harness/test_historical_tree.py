import copy
import hashlib
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

import historical_tree as h

CHECKOUT = Path(__file__).resolve().parents[3]


class HistoricalTreeTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='historical-materializer-inert-')
        self.root = Path(self.tmp.name).resolve()
        self.checkout = self.root/'checkout'; self.checkout.mkdir()
        self.parent = self.root/'copies'; self.parent.mkdir()
        (self.checkout/'source').write_bytes(b'exact source')
        self.entry = {'path': 'nested/old.py', 'source': 'source', 'bytes': 12,
                      'sha256': hashlib.sha256(b'exact source').hexdigest()}

    def tearDown(self):
        self.tmp.cleanup()  # Only owned offline test copies; original sources persist.

    def end(self): return time.monotonic()+120

    def copy(self): return h._copy_members(self.checkout, self.parent, [self.entry], self.end())

    def test_fixed_manifest_counts_and_no_process_or_network(self):
        with patch.object(subprocess, 'Popen', side_effect=AssertionError('No process')), patch.object(socket, 'socket', side_effect=AssertionError('No network')):
            value = h.load_manifest(self.end())
        self.assertEqual(len(value['files']), 670)
        self.assertEqual(value['profiles']['stored638']['count'], 639)
        self.assertEqual(value['profiles']['a2_669']['count'], 669)

    def test_exact_copy_and_distinct_source_inode(self):
        tree, receipt = self.copy()
        self.assertEqual((tree/'nested/old.py').read_bytes(), b'exact source')
        self.assertNotEqual((tree/'nested/old.py').stat().st_ino, (self.checkout/'source').stat().st_ino)
        self.assertEqual({k:receipt[k] for k in ('members','bytes','verified')}, {'members': 1, 'bytes': 12, 'verified': True})
        self.assertEqual(receipt['root_identity'], [tree.stat().st_dev,tree.stat().st_ino])

    def test_bad_source_refuses_before_creating_tree(self):
        (self.checkout/'source').write_bytes(b'changed data')
        with self.assertRaisesRegex(ValueError, 'before materialization'): self.copy()
        self.assertFalse(list(self.parent.iterdir()))

    def test_source_leaf_and_parent_symlinks_refuse(self):
        (self.checkout/'link').symlink_to('source')
        bad = dict(self.entry, source='link')
        with self.assertRaises((OSError,ValueError)): h._copy_members(self.checkout, self.parent, [bad], self.end())
        outside = self.root/'outside'; outside.mkdir(); (outside/'source').write_bytes(b'exact source')
        (self.checkout/'linked-parent').symlink_to(outside)
        bad = dict(self.entry, source='linked-parent/source')
        with self.assertRaises((OSError,ValueError)): h._copy_members(self.checkout, self.parent, [bad], self.end())
        self.assertFalse(list(self.parent.iterdir()))

    def test_path_normalization_and_duplicate_destinations(self):
        for name in ('/absolute', '../up', 'a/../b', 'a//b', './a', 'a\\b', '', '.'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                h.validate_members([dict(self.entry, path=name)])
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            h.validate_members([self.entry, dict(self.entry)])
        with self.assertRaisesRegex(ValueError, 'collision'):
            h.validate_members([dict(self.entry, path='a'), dict(self.entry, path='a/b')])

    def test_formal_sizes_and_bounds(self):
        for size in (True, -1, 12.0, h.MAX_MEMBER+1):
            with self.assertRaises(ValueError): h.validate_members([dict(self.entry, bytes=size)])
        many = [dict(self.entry, path=str(i), bytes=h.MAX_MEMBER) for i in range(8)]
        with self.assertRaisesRegex(ValueError, 'Aggregate'): h.validate_members(many)
        with self.assertRaises(ValueError): h.validate_members([dict(self.entry, extra=1)])

    def test_no_missing_extra_changed_or_symlink_members(self):
        tree, _ = self.copy()
        (tree/'extra').write_bytes(b'x')
        with self.assertRaisesRegex(ValueError, 'Undeclared'): h.verify_tree(tree, [self.entry], self.end())
        (tree/'extra').unlink()
        target = tree/'nested/old.py'; target.write_bytes(b'same length!')
        with self.assertRaisesRegex(ValueError, 'bytes differ'): h.verify_tree(tree, [self.entry], self.end())
        target.unlink()
        with self.assertRaisesRegex(ValueError, 'missing'): h.verify_tree(tree, [self.entry], self.end())
        target.symlink_to(self.checkout/'source')
        with self.assertRaisesRegex(ValueError, 'Nonregular'): h.verify_tree(tree, [self.entry], self.end())

    def test_source_change_between_preflight_and_copy_is_retained_failure(self):
        original = h.digest_file
        calls = 0
        def changed(root, name, maximum, deadline):
            nonlocal calls
            result = original(root, name, maximum, deadline); calls += 1
            if calls == 1: (self.checkout/'source').write_bytes(b'changed data')
            return result
        with patch.object(h, 'digest_file', side_effect=changed):
            with self.assertRaisesRegex(ValueError, 'Copied historical bytes') as caught: self.copy()
        self.assertEqual(len(list(self.parent.iterdir())), 1)
        self.assertIn('retained:', caught.exception.__notes__[0])
        self.assertEqual((self.checkout/'source').read_bytes(), b'changed data')

    def test_copy_write_failure_retains_partial_tree(self):
        original = os.open
        def fail(path, flags, *args, **kwargs):
            if flags & os.O_EXCL: raise OSError('injected output failure')
            return original(path, flags, *args, **kwargs)
        with patch.object(os, 'open', fail):
            with self.assertRaisesRegex(OSError, 'output failure'): self.copy()
        self.assertEqual(len(list(self.parent.iterdir())), 1)

    def test_expired_or_boolean_deadline_prevents_copy(self):
        for deadline in (True, float('nan'), float('inf'), time.monotonic()-1):
            with self.assertRaises(ValueError): h._copy_members(self.checkout, self.parent, [self.entry], deadline)
        self.assertFalse(list(self.parent.iterdir()))

    def test_duplicate_manifest_keys_and_changed_pin_refuse(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate'): json.loads('{"a":1,"a":2}', object_pairs_hook=h.unique)
        original = h.bounded_bytes
        def tamper(root, name, maximum, deadline): return original(root,name,maximum,deadline)+b' '
        with patch.object(h, 'bounded_bytes', tamper):
            with self.assertRaisesRegex(ValueError, 'fixed manifest changed'): h.load_manifest(self.end())

    def test_unknown_profile_cannot_copy(self):
        with self.assertRaisesRegex(ValueError, 'Unknown historical'):
            h.materialize(CHECKOUT, self.parent, 'current', deadline=self.end())
        self.assertFalse(list(self.parent.iterdir()))

    def test_symlink_ancestor_of_declared_root_refuses(self):
        alias = self.root/'alias';alias.symlink_to(self.root)
        with self.assertRaises(OSError):
            h._copy_members(alias/'checkout', self.parent, [self.entry], self.end())
        with self.assertRaises(OSError):
            h._copy_members(self.checkout, alias/'copies', [self.entry], self.end())
        self.assertFalse(list(self.parent.iterdir()))

    def test_parent_swap_cannot_write_through_new_symlink(self):
        outside = self.root/'outside';outside.mkdir()
        original = os.open
        changed = False
        def swap(path, flags, *args, **kwargs):
            nonlocal changed
            if path == 'old.py' and flags & os.O_EXCL and not changed:
                changed=True
                tree=next(self.parent.iterdir())
                (tree/'nested').rename(tree/'retained-dir')
                (tree/'nested').symlink_to(outside)
            return original(path,flags,*args,**kwargs)
        with patch.object(os,'open',swap):
            with self.assertRaises((ValueError,OSError)): self.copy()
        self.assertTrue(changed)
        self.assertFalse(list(outside.iterdir()))
        tree=next(self.parent.iterdir())
        self.assertEqual((tree/'retained-dir/old.py').read_bytes(),b'exact source')

    def test_extra_empty_directory_is_not_part_of_exact_tree(self):
        tree,_=self.copy();(tree/'empty').mkdir()
        with self.assertRaisesRegex(ValueError,'Undeclared materialized directory'):
            h.verify_tree(tree,[self.entry],self.end())

    def test_bounded_read_refuses_oversize_without_reading_whole_file(self):
        (self.checkout/'large').write_bytes(b'x'*100000)
        with self.assertRaisesRegex(ValueError,'Read exceeds'):
            h.bounded_bytes(self.checkout,'large',16,self.end())

    def test_expected_root_identity_rejects_replacement(self):
        tree,receipt=self.copy()
        other,_=self.copy()
        with self.assertRaisesRegex(ValueError,'root identity'):
            h.verify_tree(other,[self.entry],self.end(),identity=receipt['root_identity'])

    def test_nonregular_fifo_refuses_without_waiting_for_writer(self):
        os.mkfifo(self.checkout/'pipe')
        start=time.monotonic()
        with self.assertRaisesRegex(ValueError,'not regular'):
            h.digest_file(self.checkout,'pipe',16,self.end())
        self.assertLess(time.monotonic()-start,1)

    def test_historical_expected_metadata_unchanged_by_workflow_locator(self):
        manifest=h.load_manifest(self.end())
        metadata={'profiles':manifest['profiles'],'files':{k:{x:v[x] for x in ('path','bytes','sha256')} for k,v in manifest['files'].items()}}
        digest=hashlib.sha256(json.dumps(metadata,sort_keys=True,separators=(',',':')).encode()).hexdigest()
        self.assertEqual(digest, 'ec24df8b3fe36e73ab198c3dfc2b4cf12ee03a2d5a7a693f8df8573f38cf4a07')
        entry=manifest['files']['.github/workflows/ci.yml']
        self.assertEqual(entry['source'],'tests/controlled-drugs/fixtures/record-review-v3/historical/ci-original.yml')
        self.assertEqual(entry['sha256'],'40aab13dc012c10613b00368cf233dead2c2bc77c430b041b335a6fe8b14eb76')

    def workflow_specimen(self):
        entry=h.load_manifest(self.end())['files']['.github/workflows/ci.yml']
        current=self.checkout/entry['path'];current.parent.mkdir(parents=True)
        current.write_bytes(b'deliberately changed current workflow')
        payload=self.checkout/entry['source'];payload.parent.mkdir(parents=True)
        payload.write_bytes((CHECKOUT/entry['source']).read_bytes())
        return entry,payload

    def test_current_workflow_is_never_historical_fallback(self):
        entry,payload=self.workflow_specimen()
        tree,_=h._copy_members(self.checkout,self.parent,[entry],self.end())
        self.assertEqual((tree/entry['path']).read_bytes(),payload.read_bytes())
        self.assertNotEqual((tree/entry['path']).read_bytes(),(self.checkout/entry['path']).read_bytes())

    def test_missing_or_changed_workflow_override_refuses(self):
        entry,payload=self.workflow_specimen()
        # Even a matching current workflow cannot replace the explicit payload.
        (self.checkout/entry['path']).write_bytes(payload.read_bytes())
        payload.unlink()
        with self.assertRaises(FileNotFoundError):h._copy_members(self.checkout,self.parent,[entry],self.end())
        self.assertFalse(list(self.parent.iterdir()))
        payload.write_bytes(b'changed historical override')
        with self.assertRaises(ValueError):h._copy_members(self.checkout,self.parent,[entry],self.end())
        self.assertFalse(list(self.parent.iterdir()))

    def test_real_stored638_and_a2_669_trees_and_unchanged_gates(self):
        worker = r'''
import importlib.util,json,pathlib,socket,subprocess,sys,time
from unittest.mock import patch
assert __debug__ and sys.flags.optimize == 0
root=pathlib.Path(sys.argv[1]);profile=sys.argv[2]
source=root/'tests/controlled-drugs/engine/candidate'
sys.path.insert(0,str(source))
with patch.object(subprocess,'Popen',side_effect=AssertionError('No database/process in historical worker')),patch.object(socket,'socket',side_effect=AssertionError('No socket in historical worker')):
 if profile=='stored638':
  import record_review_v3_gate_a_runtime as owned
  import record_review_v3_configuration_record_runtime as runtime
  values=runtime.integration_gate(owned,time.monotonic()+60)
  assert len(values)==638
  assert not (root/'tmp/secondary-review-20261021/configuration-record-fixture-draft').exists()
 else:
  path=source/'record_review_v3_a2_positive/runtime.py'
  spec=importlib.util.spec_from_file_location('fixed_a2_runtime',path)
  runtime=importlib.util.module_from_spec(spec);sys.modules[spec.name]=runtime;spec.loader.exec_module(runtime)
  values=runtime.input_map(lambda:None)
  assert len(values)==669 and len(runtime.dep.owned.source_inputs())==645
 print(json.dumps({'profile':profile,'source_count':len(values),'unchanged_gate_passed':True,'database_commands':0}))
'''
        manifest = h.load_manifest(self.end())
        for profile, (count, size, collector) in h.EXPECTED_PROFILES.items():
            with self.subTest(profile=profile):
                tree, receipt = h.materialize(CHECKOUT, self.parent, profile, deadline=self.end())
                self.assertEqual((receipt['members'], receipt['bytes'], receipt['collector_count']), (count, size, collector))
                expected = [manifest['files'][n] for n in manifest['profiles'][profile]['paths']]
                h.verify_tree(tree, expected, self.end())
                result = subprocess.run([sys.executable, '-I', '-B', '-c', worker, str(tree), profile], capture_output=True, text=True, timeout=60)
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertTrue(json.loads(result.stdout)['unchanged_gate_passed'])
                self.assertFalse(list(tree.rglob('__pycache__')))
                print('REAL_HISTORICAL_GATE', result.stdout.strip(), flush=True)


if __name__ == '__main__': unittest.main()
