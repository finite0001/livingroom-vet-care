import hashlib
import importlib.util
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('historical_mutation_test_subject',HERE/'mutation.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
meta=lambda raw:{'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest()}


class MutationTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(prefix='tiny-boundary-',dir=Path(tempfile.gettempdir()).resolve());self.base=Path(self.tmp.name)
        self.tree=self.base/'tree';self.evidence=self.base/'evidence';self.tree.mkdir();self.evidence.mkdir()
        (self.tree/'a').mkdir();(self.tree/'a/file.sql').write_bytes(b'old\n');(self.tree/'empty').write_bytes(b'')
        self.baseline={'a/file.sql':meta(b'old\n'),'empty':meta(b'')};s=self.tree.stat();self.identity=(s.st_dev,s.st_ino);self.opened=[]
    def tearDown(self):
        for obj in self.opened:obj.close()
        self.tmp.cleanup()
    def create(self,additions=None,check=lambda:None):
        obj=m.Mutation(self.tree,self.evidence,self.baseline,additions or {},self.identity,check);self.opened.append(obj);return obj
    def baseline_exact(self):
        root=m.Root(self.tree,lambda:None)
        try:m.verify_tree(root,self.baseline)
        finally:root.close()
    def test_replace_retains_mutant_and_original_inode_restored(self):
        original=(self.tree/'a/file.sql').stat().st_ino;o=self.create();o.replace('a/file.sql',b'changed\n');path=o.evidence.path
        self.assertEqual((path/'original-00').read_bytes(),b'old\n');result=o.restore();self.assertTrue(result['restored'])
        self.assertEqual((path/'mutant-00').read_bytes(),b'changed\n');self.assertEqual((self.tree/'a/file.sql').stat().st_ino,original);self.baseline_exact()
    def test_remove_restores_and_retains_receipt(self):
        o=self.create();o.remove('a/file.sql');self.assertFalse((self.tree/'a/file.sql').exists());o.restore();self.baseline_exact()
        self.assertTrue((o.evidence.path/'restoration.json').is_file())
    def test_symlink_same_bytes_retained_as_link_after_restore(self):
        o=self.create();o.symlink_same_bytes('a/file.sql');p=self.tree/'a/file.sql';self.assertTrue(p.is_symlink());self.assertEqual(p.read_bytes(),b'old\n')
        o.restore();self.assertFalse(p.is_symlink());self.assertTrue((o.evidence.path/'mutant-00').is_symlink());self.baseline_exact()
    def test_add_and_created_directories_restore_deepest_first(self):
        additions={'new/deep/one.py':meta(b'one'),'new/deep/two.py':meta(b'two')};o=self.create(additions)
        o.add('new/deep/one.py',b'one');o.add('new/deep/two.py',b'two');ids=dict(o.created);o.restore();self.baseline_exact()
        self.assertFalse((self.tree/'new').exists());self.assertEqual(len(ids),2)
        retained=[p for p in o.evidence.path.iterdir()if p.is_dir()];self.assertEqual(len(retained),2)
        self.assertEqual({p.stat().st_ino for p in retained},{v[1]for v in ids.values()})
    def test_add_to_existing_directory_never_moves_baseline_directory(self):
        old=(self.tree/'a').stat().st_ino;o=self.create({'a/new.sql':meta(b'x')});o.add('a/new.sql',b'x');o.restore()
        self.assertEqual((self.tree/'a').stat().st_ino,old);self.assertEqual(o.created,{});self.baseline_exact()
    def test_undeclared_path_refuses_and_latches_failure(self):
        o=self.create()
        with self.assertRaisesRegex(ValueError,'undeclared'):o.remove('unknown')
        with self.assertRaisesRegex(ValueError,'unavailable'):o.replace('empty',b'x')
        with self.assertRaisesRegex(ValueError,'unavailable'):o.restore()
        self.baseline_exact()
    def test_addition_digest_mismatch_refuses_before_write(self):
        o=self.create({'a/new':meta(b'x')})
        with self.assertRaisesRegex(ValueError,'fixed expectation'):o.add('a/new',b'y')
        self.assertFalse((self.tree/'a/new').exists());self.assertTrue(o.failed)
    def test_mutant_drift_refuses_without_overwriting(self):
        o=self.create();o.replace('a/file.sql',b'changed');(self.tree/'a/file.sql').write_bytes(b'foreign')
        with self.assertRaises(ValueError):o.restore()
        self.assertEqual((self.tree/'a/file.sql').read_bytes(),b'foreign');self.assertEqual((o.evidence.path/'original-00').read_bytes(),b'old\n')
    def test_saved_original_drift_refuses(self):
        o=self.create();o.remove('a/file.sql');(o.evidence.path/'original-00').write_bytes(b'evil')
        with self.assertRaises(ValueError):o.restore()
        self.assertFalse((self.tree/'a/file.sql').exists());self.assertTrue(o.failed)
    def test_created_directory_unexpected_file_refuses_and_retains(self):
        o=self.create({'new/deep/file':meta(b'x')});o.add('new/deep/file',b'x');(self.tree/'new/deep/foreign').write_bytes(b'foreign')
        with self.assertRaisesRegex(ValueError,'not empty'):o.restore()
        self.assertTrue((self.tree/'new/deep/foreign').exists());self.assertEqual((o.evidence.path/'mutant-00').read_bytes(),b'x')
    def test_created_directory_identity_substitution_refuses(self):
        o=self.create({'new/file':meta(b'x')});o.add('new/file',b'x');(self.tree/'new').rename(self.tree/'old-new');(self.tree/'new').mkdir();(self.tree/'new/file').write_bytes(b'x')
        with self.assertRaisesRegex(ValueError,'unadmitted'):o.restore()
        self.assertTrue((self.tree/'old-new/file').exists())
    def test_duplicate_operation_refuses(self):
        o=self.create();o.replace('a/file.sql',b'x')
        with self.assertRaisesRegex(ValueError,'unique'):o.replace('a/file.sql',b'y')
        self.assertEqual((self.tree/'a/file.sql').read_bytes(),b'x')
    def test_failed_write_retains_original_and_exact_partial(self):
        o=self.create();write=os.write;calls=0
        def partial(fd,raw):
            nonlocal calls
            calls+=1
            if calls==1:return write(fd,raw[:2])
            raise OSError('injected write')
        with mock.patch.object(m.os,'write',partial),self.assertRaises(OSError):o.replace('a/file.sql',b'changed')
        self.assertEqual((self.tree/'a/file.sql').read_bytes(),b'ch');self.assertEqual((o.evidence.path/'original-00').read_bytes(),b'old\n');self.assertTrue(o.failed)
    def test_short_writes_have_no_duplicate_bytes(self):
        o=self.create();write=os.write
        with mock.patch.object(m.os,'write',lambda fd,raw:write(fd,raw[:1])):o.replace('a/file.sql',b'changed')
        self.assertEqual((self.tree/'a/file.sql').read_bytes(),b'changed');o.restore();self.baseline_exact()
    def test_deadline_after_original_rename_retains_both_locations(self):
        expired=False
        def check():
            if expired:raise TimeoutError('original deadline')
        o=self.create(check=check);rename=os.rename
        def late(*args,**kwargs):
            nonlocal expired
            value=rename(*args,**kwargs);expired=True;return value
        with mock.patch.object(m.os,'rename',late),self.assertRaises(TimeoutError):o.replace('a/file.sql',b'x')
        self.assertFalse((self.tree/'a/file.sql').exists());self.assertEqual((o.evidence.path/'original-00').read_bytes(),b'old\n');self.assertTrue(o.failed)
    def test_baseline_fifo_rejected_before_evidence_creation(self):
        (self.tree/'empty').unlink();os.mkfifo(self.tree/'empty')
        with self.assertRaises(ValueError):self.create()
        self.assertEqual(list(self.evidence.iterdir()),[])
    def test_wrong_root_identity_rejected(self):
        with self.assertRaisesRegex(ValueError,'root identity'):m.Mutation(self.tree,self.evidence,self.baseline,{},(1,2),lambda:None)
        self.assertEqual(list(self.evidence.iterdir()),[])
    def test_evidence_same_or_descendant_source_refused(self):
        with self.assertRaisesRegex(ValueError,'inside source'):m.Mutation(self.tree,self.tree,self.baseline,{},self.identity,lambda:None)
    def test_evidence_collision_never_overwrites(self):
        o=self.create();(o.evidence.path/'original-00').write_bytes(b'foreign')
        with self.assertRaisesRegex(ValueError,'occupied'):o.remove('a/file.sql')
        self.assertEqual((self.tree/'a/file.sql').read_bytes(),b'old\n');self.assertEqual((o.evidence.path/'original-00').read_bytes(),b'foreign')
    def test_ancestor_symlink_swap_fails_with_original_evidence_retained(self):
        o=self.create();o.replace('a/file.sql',b'x');outside=self.base/'outside';outside.mkdir();(outside/'file.sql').write_bytes(b'foreign')
        (self.tree/'a').rename(self.tree/'held-a');(self.tree/'a').symlink_to(outside,target_is_directory=True)
        with self.assertRaises(OSError):o.restore()
        self.assertEqual((outside/'file.sql').read_bytes(),b'foreign');self.assertEqual((o.evidence.path/'original-00').read_bytes(),b'old\n')

    def test_complete_mutation_delta_for_missing_and_symlink(self):
        o=self.create();o.remove('a/file.sql');self.assertTrue(o.verify_mutated()['verified']);o.restore()
        o=self.create();o.symlink_same_bytes('a/file.sql');self.assertTrue(o.verify_mutated()['verified']);o.restore()
    def test_unrelated_drift_blocks_expected_refusal_phase(self):
        o=self.create();o.replace('a/file.sql',b'x');(self.tree/'empty').write_bytes(b'foreign')
        with self.assertRaises(ValueError):o.verify_mutated()
        self.assertTrue(o.failed)
    def test_invalid_payload_refuses_before_original_move(self):
        o=self.create()
        with self.assertRaisesRegex(ValueError,'formal mutation'):o.replace('a/file.sql',None)
        self.assertEqual((self.tree/'a/file.sql').read_bytes(),b'old\n')
        self.assertEqual(list(o.evidence.path.iterdir()),[])


    def _corrupt_target(self, target, variant):
        if variant == 'same_length': target.write_bytes(b'evil')
        elif variant == 'delete': target.unlink()
        elif variant == 'replace':
            target.rename(target.with_name('displaced-target')); target.write_bytes(b'old\n')
        elif variant == 'symlink':
            target.rename(target.with_name('displaced-target')); target.symlink_to(target.with_name('displaced-target'))
        elif variant == 'hardlink': os.link(target, target.with_name('second-link'))
        elif variant == 'directory':
            target.rename(target.with_name('displaced-target')); target.mkdir()
        elif variant == 'fifo':
            target.rename(target.with_name('displaced-target')); os.mkfifo(target)
        else: self.fail('unknown adversary')

    def test_target_adversaries_refuse_verification_and_direct_restoration(self):
        for variant in ('same_length','delete','replace','symlink','hardlink','directory','fifo'):
            for operation in ('verify_mutated','restore'):
                with self.subTest(variant=variant,operation=operation):
                    # Fresh tiny tree for every direct-path replay; failed trees stay intact until teardown.
                    tree=self.base/(variant+'-'+operation);tree.mkdir();(tree/'f').write_bytes(b'old\n'); st=tree.stat()
                    o=m.Mutation(tree,self.evidence,{'f':meta(b'old\n')},{},(st.st_dev,st.st_ino),lambda:None);self.opened.append(o)
                    o.symlink_same_bytes('f');target=o.evidence.path/'original-00-link-target'
                    self._corrupt_target(target,variant)
                    with self.assertRaises((ValueError,OSError)):getattr(o,operation)()
                    self.assertTrue(o.failed);self.assertFalse(o.restored)
                    self.assertEqual((o.evidence.path/'original-00').read_bytes(),b'old\n')
                    self.assertTrue((tree/'f').is_symlink());self.assertFalse((o.evidence.path/'restoration.json').exists())
                    with self.assertRaisesRegex(ValueError,'unavailable'):o.restore()

    def test_target_corruption_after_creation_is_not_completed_mutation(self):
        for variant in ('same_length','replace','symlink','hardlink','delete'):
            with self.subTest(variant=variant):
                tree=self.base/('creation-'+variant);tree.mkdir();(tree/'f').write_bytes(b'old\n');st=tree.stat()
                o=m.Mutation(tree,self.evidence,{'f':meta(b'old\n')},{},(st.st_dev,st.st_ino),lambda:None);self.opened.append(o)
                create=m.new_file
                def changed(root,name,raw,check):
                    result=create(root,name,raw,check)
                    if name.endswith('-link-target'):self._corrupt_target(root.path/name,variant)
                    return result
                with mock.patch.object(m,'new_file',changed),self.assertRaises((ValueError,OSError)):o.symlink_same_bytes('f')
                self.assertTrue(o.failed);self.assertFalse(o.records[0]['complete']);self.assertFalse(o.restored)
                self.assertEqual((o.evidence.path/'original-00').read_bytes(),b'old\n')

    def test_target_drift_during_symlink_creation_is_refused(self):
        o=self.create();symlink=os.symlink
        def changed(target,*args,**kwargs):
            symlink(target,*args,**kwargs);Path(target).write_bytes(b'evil')
        with mock.patch.object(m.os,'symlink',changed),self.assertRaises(ValueError):o.symlink_same_bytes('a/file.sql')
        self.assertTrue(o.failed);self.assertFalse(o.records[0]['complete']);self.assertFalse(o.restored)
        self.assertEqual((o.evidence.path/'original-00').read_bytes(),b'old\n')

    def test_all_targets_preflight_before_any_original_restored(self):
        o=self.create();o.symlink_same_bytes('a/file.sql');o.replace('empty',b'x')
        (o.evidence.path/'original-00-link-target').write_bytes(b'evil')
        with self.assertRaises(ValueError):o.restore()
        self.assertEqual((o.evidence.path/'original-00').read_bytes(),b'old\n')
        self.assertEqual((o.evidence.path/'original-01').read_bytes(),b'')
        self.assertEqual((self.tree/'empty').read_bytes(),b'x')

    def test_retained_target_checked_after_original_restoration(self):
        o=self.create();o.symlink_same_bytes('a/file.sql');move=o._move
        def changed(source,name,destination,target):
            move(source,name,destination,target)
            if source is o.evidence and name=='original-00':
                (o.evidence.path/'original-00-link-target').write_bytes(b'evil')
        with mock.patch.object(o,'_move',changed),self.assertRaises(ValueError):o.restore()
        self.assertTrue(o.failed);self.assertFalse(o.restored);self.baseline_exact()
        self.assertTrue((o.evidence.path/'mutant-00').is_symlink())
        self.assertFalse((o.evidence.path/'restoration.json').exists())

    def test_success_receipt_binds_exact_retained_target(self):
        o=self.create();r=o.symlink_same_bytes('a/file.sql');target=o.evidence.path/r['target_name']
        self.assertEqual(r['target_metadata'],self.baseline['a/file.sql'])
        self.assertEqual(r['target_identity'],list(m.leaf_identity(target.stat())))
        self.assertTrue(o.verify_mutated()['verified']);receipt=o.restore()
        self.assertEqual(receipt['operations'][0]['after']['retained_target']['metadata'],self.baseline['a/file.sql'])
        self.assertEqual((o.evidence.path/'mutant-00').read_bytes(),b'old\n');self.assertTrue(o.restored)

    def test_new_file_same_byte_replacement_before_read_is_refused(self):
        o=self.create();reader=m.read;swapped=False
        def replaced(root,name,expected,**kwargs):
            nonlocal swapped
            if name.endswith('-link-target') and not swapped:
                swapped=True;p=root.path/name;p.rename(p.with_name('displaced-at-create'));p.write_bytes(b'old\n')
            return reader(root,name,expected,**kwargs)
        with mock.patch.object(m,'read',replaced),self.assertRaisesRegex(ValueError,'created file replaced'):o.symlink_same_bytes('a/file.sql')
        self.assertTrue(o.failed);self.assertFalse(o.records[0]['complete'])


    def test_retained_target_rechecked_after_receipt_write(self):
        o=self.create();o.symlink_same_bytes('a/file.sql');create=m.new_file
        def changed(root,name,raw,check):
            result=create(root,name,raw,check)
            if name=='restoration.json':(o.evidence.path/'original-00-link-target').write_bytes(b'evil')
            return result
        with mock.patch.object(m,'new_file',changed),self.assertRaises(ValueError):o.restore()
        self.assertTrue(o.failed);self.assertFalse(o.restored);self.baseline_exact()
        self.assertTrue((o.evidence.path/'restoration.json').is_file())
        # A written observation never overrides a raised failure or authorizes case PASS.
        with self.assertRaisesRegex(ValueError,'unavailable'):o.restore()


if __name__=='__main__':unittest.main()
