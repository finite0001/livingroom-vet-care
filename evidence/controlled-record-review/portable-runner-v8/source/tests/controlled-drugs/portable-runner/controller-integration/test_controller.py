"""Tiny physical controller negatives. No target, setup, process or DB execution."""
from dataclasses import FrozenInstanceError
import hashlib
import importlib.util
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('controller_integration_under_test',HERE/'controller.py')
c=importlib.util.module_from_spec(spec);sys.modules[spec.name]=c;spec.loader.exec_module(c)
spec=importlib.util.spec_from_file_location('controller_actual_copier',HERE.parent/'source_copy.py')
copier=importlib.util.module_from_spec(spec);sys.modules[spec.name]=copier;spec.loader.exec_module(copier)


class ControllerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.no_child=patch.object(subprocess,'Popen',side_effect=AssertionError('no process allowed'))
        cls.no_socket=patch.object(socket,'socket',side_effect=AssertionError('no network allowed'))
        cls.no_child.start();cls.no_socket.start()

    @classmethod
    def tearDownClass(cls):
        cls.no_child.stop();cls.no_socket.stop()

    def setUp(self):
        self.parent=Path(tempfile.mkdtemp(prefix='lrv-controller-unit-')).resolve();self.parent.chmod(0o700)
        self.root=self.parent/'source';self.root.mkdir(mode=0o700)
        (self.root/'nested').mkdir(mode=0o700)
        self.path=self.root/'nested/input.py';self.path.write_bytes(b'fixed source\n');self.path.chmod(0o600)
        self.metadata={'bytes':13,'sha256':hashlib.sha256(b'fixed source\n').hexdigest()}
        self.manifest={'nested/input.py':self.metadata}

    def test_exact_complete_source_tree_returns_immutable_snapshot(self):
        snapshot=c.admit_tree(self.root,self.manifest,lambda:None)
        self.assertEqual(c.admit_tree(self.root,self.manifest,lambda:None,snapshot),snapshot)
        with self.assertRaises(FrozenInstanceError):snapshot.root=()

    def test_changed_bytes_are_not_resealed(self):
        snapshot=c.admit_tree(self.root,self.manifest,lambda:None)
        self.path.write_bytes(b'changed bytes')
        with self.assertRaises(ValueError):c.admit_tree(self.root,self.manifest,lambda:None,snapshot)

    def test_rewrite_identical_bytes_changes_physical_evidence(self):
        snapshot=c.admit_tree(self.root,self.manifest,lambda:None)
        new=self.path.with_name('replacement');new.write_bytes(b'fixed source\n');new.chmod(0o600);new.replace(self.path)
        with self.assertRaisesRegex(ValueError,'identity'):c.admit_tree(self.root,self.manifest,lambda:None,snapshot)

    def test_root_replacement_cannot_reuse_old_leaf_inodes(self):
        snapshot=c.admit_tree(self.root,self.manifest,lambda:None)
        moved=self.parent/'moved';self.root.rename(moved);self.root.mkdir(mode=0o700)
        (moved/'nested').rename(self.root/'nested')
        with self.assertRaisesRegex(ValueError,'root changed'):c.admit_tree(self.root,self.manifest,lambda:None,snapshot)

    def test_directory_replacement_cannot_reuse_old_leaf_inodes(self):
        snapshot=c.admit_tree(self.root,self.manifest,lambda:None)
        moved=self.root/'old';(self.root/'nested').rename(moved);(self.root/'nested').mkdir(mode=0o700)
        (moved/'input.py').rename(self.path);moved.rmdir()
        with self.assertRaisesRegex(ValueError,'changed'):c.admit_tree(self.root,self.manifest,lambda:None,snapshot)

    def test_extra_python_json_and_empty_directory_are_not_ignored(self):
        for name,directory in [('foreign.py',False),('foreign.json',False),('empty',True)]:
            path=self.root/name
            if directory:path.mkdir(mode=0o700)
            else:path.write_bytes(b'x');path.chmod(0o600)
            with self.assertRaises(ValueError):c.admit_tree(self.root,self.manifest,lambda:None)
            if directory:path.rmdir()
            else:path.unlink()

    def test_missing_source_member_refuses(self):
        self.path.unlink()
        with self.assertRaises(ValueError):c.admit_tree(self.root,self.manifest,lambda:None)

    def test_source_links_and_hardlinks_refuse(self):
        original=self.parent/'original';self.path.rename(original);self.path.symlink_to(original)
        with self.assertRaises(OSError):c.admit_tree(self.root,self.manifest,lambda:None)
        self.path.unlink();os.link(original,self.path)
        with self.assertRaises(ValueError):c.admit_tree(self.root,self.manifest,lambda:None)

    def test_directory_link_refuses_before_any_import(self):
        (self.root/'nested').rename(self.parent/'nested');(self.root/'nested').symlink_to(self.parent/'nested',target_is_directory=True)
        with self.assertRaises(ValueError):c.admit_tree(self.root,self.manifest,lambda:None)

    def test_nonprivate_root_directory_and_writable_source_refuse(self):
        self.root.chmod(0o755)
        with self.assertRaises(ValueError):c.admit_tree(self.root,self.manifest,lambda:None)
        self.root.chmod(0o700);self.path.chmod(0o622)
        with self.assertRaises(ValueError):c.admit_tree(self.root,self.manifest,lambda:None)

    def test_five_slot_empty_stream_is_legal_but_empty_job_is_not(self):
        self.path.write_bytes(b'')
        raw,_=c.physical(self.path,check=lambda:None,maximum=4*c.MIB,empty=True)
        self.assertEqual(raw,b'')
        with self.assertRaises(ValueError):c.physical(self.path,check=lambda:None)

    def test_stream_hash_is_checked_without_retaining_raw_bytes(self):
        raw,stamp=c.physical(self.path,check=lambda:None,expected=self.metadata,retain=False)
        self.assertEqual(raw,b'');self.assertEqual(stamp[5],13)
        with self.assertRaises(ValueError):c.physical(self.path,check=lambda:None,expected={**self.metadata,'sha256':'0'*64},retain=False)

    def test_original_deadline_callback_failure_propagates(self):
        count=[0]
        def check():
            count[0]+=1
            if count[0]>4:raise TimeoutError('original cutoff')
        with self.assertRaises(TimeoutError):c.admit_tree(self.root,self.manifest,check)

    def test_midread_mutation_refuses(self):
        changed=[False]
        original=os.read
        def read(fd,count):
            raw=original(fd,count)
            if raw and not changed[0]:changed[0]=True;self.path.write_bytes(b'changed bytes')
            return raw
        with patch.object(os,'read',side_effect=read),self.assertRaises(ValueError):c.physical(self.path,check=lambda:None,expected=self.metadata)

    def test_final_close_error_is_not_credited_as_a_physical_read(self):
        original=os.close;seen=[]
        def close(fd):
            original(fd);seen.append(fd)
            if len(seen)==1:raise OSError('close failure')
        with patch.object(os,'close',side_effect=close),self.assertRaisesRegex(OSError,'close failure'):
            c.physical(self.path,check=lambda:None,expected=self.metadata)
        self.assertEqual(len(seen),len(set(seen)))
        self.assertGreater(len(seen),1)

    def test_strict_json_rejects_duplicate_and_nonfinite_profile(self):
        for raw in (b'{"a":1,"a":1}',b'{"a":NaN}',b'{"a":Infinity}',b'{"a":1e999}'):
            with self.assertRaises(ValueError):c.strict(raw)

    def bare_controller(self):
        value=c.Controller.__new__(c.Controller);value.failed=False;value.output=self.root;value.copy_bytes=13
        st=self.root.stat();value.output_identity=st.st_dev,st.st_ino
        return value

    def test_capacity_callback_cannot_hide_latched_failure_at_final_check(self):
        value=self.bare_controller();calls=[]
        def capacity(path):
            value.failed=True;calls.append(path);return SimpleNamespace(f_bavail=20*c.GIB,f_frsize=1)
        with patch.object(c.os,'statvfs',side_effect=capacity),self.assertRaisesRegex(ValueError,'failed during'):
            value.check(c.time.monotonic()+30)
        self.assertEqual(len(calls),1)

    def test_filesystem_check_cannot_return_success_after_original_deadline(self):
        value=self.bare_controller()
        with patch.object(c.time,'monotonic',side_effect=[1.0,3.0]),patch.object(c.os,'statvfs',return_value=SimpleNamespace(f_bavail=20*c.GIB,f_frsize=1)):
            with self.assertRaisesRegex(ValueError,'exhausted during'):value.check(2.0)

    def assembly_inputs(self):
        old=self.root/'tmp/prototype';old.mkdir(parents=True,mode=0o700)
        (old/'source.py').write_bytes(b'fixed source\n');(old/'source.py').chmod(0o600)
        output=self.parent/'assembly';output.mkdir(mode=0o700)
        target='tests/controlled-drugs/portable-runner/source.py'
        recipe={target:{'source':'tmp/prototype/source.py',**self.metadata}}
        return output,target,recipe,{target:self.metadata}

    def test_complete_recipe_canonical_relocation_never_relaxes_private_destination_policy(self):
        output,target,recipe,expected=self.assembly_inputs()
        result=c.assemble_publication(recipe,expected,self.root,output,deadline=c.time.monotonic()+30,source_copy_module=copier)
        published=Path(result['root'])
        self.assertEqual((published/target).read_bytes(),b'fixed source\n')
        self.assertFalse((published/'tmp').exists());self.assertFalse(result['controller_execution'])
        self.assertEqual(len(c.admit_tree(published,expected,lambda:None).files),1)

    def test_private_destination_refuses_before_any_publication_directory(self):
        output,_,_,_=self.assembly_inputs();name='tmp/prototype/source.py'
        with self.assertRaises(ValueError):c.assemble_publication({name:{'source':name,**self.metadata}},
            {name:self.metadata},self.root,output,deadline=c.time.monotonic()+30,source_copy_module=copier)
        self.assertEqual(list(output.iterdir()),[])

    def test_recipe_and_manifest_must_agree_before_copying_any_member(self):
        output,target,recipe,expected=self.assembly_inputs();recipe[target]['sha256']='0'*64
        with self.assertRaises(ValueError):c.assemble_publication(recipe,expected,self.root,output,
            deadline=c.time.monotonic()+30,source_copy_module=copier)
        self.assertEqual(list(output.iterdir()),[])

    def test_changed_source_refuses_before_publication_not_observed_reseal(self):
        output,target,recipe,expected=self.assembly_inputs();(self.root/recipe[target]['source']).write_bytes(b'changed bytes')
        with self.assertRaises(ValueError):c.assemble_publication(recipe,expected,self.root,output,
            deadline=c.time.monotonic()+30,source_copy_module=copier)
        self.assertEqual(list(output.iterdir()),[])

    def test_assembly_parent_inside_source_cannot_be_used_for_hidden_overlay(self):
        output,target,recipe,expected=self.assembly_inputs();inside=self.root/'output';inside.mkdir(mode=0o700)
        with self.assertRaises(ValueError):c.assemble_publication(recipe,expected,self.root,inside,
            deadline=c.time.monotonic()+30,source_copy_module=copier)
        self.assertEqual(list(inside.iterdir()),[])

    def test_boundary_evidence_counts_as_scratch_only_exact_root_slots_are_separate(self):
        value=c.Controller.__new__(c.Controller);value.scratch=[self.root]
        value.output_scratch={str(self.root):('job.json','stdout.log','stderr.log','terminal.json','guard.json')}
        (self.root/'job.json').write_bytes(b'x'*100)
        with patch.object(c,'GIB',30):
            value.scratch_check(lambda:None)  #13 source bytes; root job slot is accounted in shared pool.
            (self.root/'boundary-evidence').mkdir()
            (self.root/'boundary-evidence/job.json').write_bytes(b'x'*20)
            with self.assertRaisesRegex(ValueError,'retained scratch'):value.scratch_check(lambda:None)

    def test_historical_adapter_job_retains_tree_after_all_tool_paths_are_bound(self):
        value=c.Controller.__new__(c.Controller)
        value.clean=self.root;value.output=self.parent/'run';value.output.mkdir(mode=0o700)
        value.job_directories={};value.scratch=[];value.output_scratch={};value.binding={}
        value.original_ids={'unit::Fixture.test_one'}
        value.p={'source_files':self.manifest,'historical_members':{'stored638':[
            {'path':'source.py',**self.metadata}]},'implementation_files':{},
            'roles':{'policy_routing':'policy/routing.json','historical_route':'route.json',
                     'historical_assertion':'assertion.py','worker':'worker.py'}}
        tools={}
        for name in ('python','node','typescript'):
            path=self.parent/(name+'.js'if name=='typescript'else name)
            path.write_bytes(b'fixed tool');path.chmod(0o600);tools[name]=str(path)
        value.admit_tools=lambda deadline,check:dict(tools)
        retained=[]
        def materialize(source,parent,profile,*,deadline):
            path=parent/'retained-tree';path.mkdir(mode=0o700);retained.append(path)
            return path,{'root_identity':[path.stat().st_dev,path.stat().st_ino]}
        config=SimpleNamespace(routes={},historical_route=None)
        value.modules={
            'historical_tree':SimpleNamespace(materialize=materialize),
            'guard':SimpleNamespace(platform_environment=lambda:{},admit_config=lambda **kwargs:config),
            'guard_report':SimpleNamespace(expected_context=lambda *args,**kwargs:{}),
            'worker_contract':SimpleNamespace(HISTORY={},admit_job=lambda *args:None),
            'partition':SimpleNamespace(),
            'guarded_job':SimpleNamespace(JobInput=lambda *args:SimpleNamespace(raw=args[0])),
        }
        definition={'profile':'current','suite':{'kind':'stored_adapter','relative':'suite.py',
            'tree_tag':'current','expected_ids':list(value.original_ids)},'partition':None}
        job=value.prepare_guarded(definition,SimpleNamespace(job_id='toy',deadline=c.time.monotonic()+30),lambda:None)
        declared=c.strict(job.raw)
        self.assertEqual(declared['historical638']['tree_root'],str(retained[0]))
        self.assertEqual(declared['guard']['source_trees'][1]['root'],str(retained[0]))
        self.assertNotEqual(declared['historical638']['tree_root'],tools['typescript'])
        self.assertTrue(Path(declared['historical638']['tree_root']).is_dir())


if __name__=='__main__':unittest.main(verbosity=2)
