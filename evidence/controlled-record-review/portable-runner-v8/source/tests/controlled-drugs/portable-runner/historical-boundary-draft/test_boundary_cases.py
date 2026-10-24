"""Tiny orchestration tests only; never execute the eight historical methods."""
import ast
from dataclasses import replace
import hashlib
import importlib.util
import os
from pathlib import Path
import sys
import tempfile
import time
import types
import unittest
from unittest import mock

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('boundary_cases_small_tests',HERE/'boundary_cases.py')
b=importlib.util.module_from_spec(spec);sys.modules[spec.name]=b;spec.loader.exec_module(b)

class CaseBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.spec=b.declaration(lambda:None)
    def context(self,index=0):
        row=self.spec['cases'][index];members=self.spec['profiles'][row['profile']]['members']
        return b.Context(Path('/owned/repository'),Path('/owned/tree'),Path('/owned/evidence'),(1,2),tuple(sorted((k,v['sha256'])for k,v in members.items())),tuple(sorted((k,v['sha256'])for k,v in self.spec['current656'].items())),row['profile'],row['id'],time.monotonic()+60)
    def function(self,source="def target():\n    assert False, 'fixed refusal'\n"):
        ns={};exec(compile(source,'tiny-target.py','exec'),ns);return ns['target']
    def capture(self,call,fn,lineno=2,message='fixed refusal',check=lambda:None,locals_check=None):
        return b.expected_assertion(call,fn.__code__,{'function':'target','lineno':lineno},message,check,locals_check)
    def test_exact_eight_methods_collected_without_execution(self):
        expected={row['id'].split('.',1)[1]for row in self.spec['cases']}
        for index in range(8):
            cls=b.build_case(self.context(index))
            self.assertEqual(set(unittest.defaultTestLoader.getTestCaseNames(cls)),expected)
    def test_wrong_selected_method_and_reuse_refuse_before_imports(self):
        c=self.context();state={'used':False}
        with mock.patch.object(b,'load_mutation',side_effect=AssertionError('must not import')):
            with self.assertRaisesRegex(ValueError,'exact singleton'):b._execute(None,c,self.spec,state,1)
            state['used']=True
            with self.assertRaisesRegex(ValueError,'fresh worker'):b._execute(None,c,self.spec,state,0)
    def test_context_exact_maps_and_profile(self):
        c=self.context();b.admit_context(c,self.spec)
        for field,value in [('baseline_map',c.baseline_map[:-1]),('current_map',c.current_map[:-1]),('baseline_map',tuple(reversed(c.baseline_map))),('baseline_map',c.baseline_map+(c.baseline_map[-1],)),('profile','a2_669'),('selected_id','unknown'),('root_identity',(True,2)),('deadline',True),('deadline',float('inf')),('deadline',time.monotonic()+601),('repository_root',Path('//alias'))]:
            with self.subTest(field=field,value=str(value)[:40]),self.assertRaises((ValueError,TimeoutError)):b.admit_context(replace(c,**{field:value}),self.spec)
    def test_context_deadline_expired(self):
        with self.assertRaises(TimeoutError):replace(self.context(),deadline=0).check()
    def test_exact_target_assertion_accepted(self):
        fn=self.function();self.assertEqual(self.capture(fn,fn)['lineno'],2)
    def test_same_message_other_function_refused(self):
        fn=self.function();other=self.function()
        with self.assertRaisesRegex(ValueError,'locus'):self.capture(other,fn)
    def test_wrong_message_line_or_subclass_refused(self):
        fn=self.function()
        with self.assertRaisesRegex(ValueError,'diagnostic'):self.capture(fn,fn,message='other')
        with self.assertRaisesRegex(ValueError,'locus'):self.capture(fn,fn,lineno=3)
        class Other(AssertionError):pass
        def callback():raise Other('fixed refusal')
        with self.assertRaisesRegex(ValueError,'diagnostic'):self.capture(callback,fn)
    def test_callback_failure_never_satisfies_target(self):
        fn=self.function('def target(callback):\n    callback()\n    assert False, "fixed refusal"\n')
        def callback():raise AssertionError('fixed refusal')
        with self.assertRaisesRegex(ValueError,'locus'):self.capture(lambda:fn(callback),fn,lineno=3)
    def test_non_assertion_and_missing_refusal_propagate(self):
        fn=self.function()
        def callback():raise OSError('own setup failure')
        with self.assertRaises(OSError):self.capture(callback,fn)
        with self.assertRaisesRegex(AssertionError,'did not occur'):self.capture(lambda:None,fn)
    def test_frame_local_predicate_and_deadline_required(self):
        fn=self.function('def target():\n    name="wrong"\n    assert False, "fixed refusal"\n')
        with self.assertRaisesRegex(ValueError,'offending'):self.capture(fn,fn,lineno=3,locals_check=lambda x:x['name']=='expected')
        calls=0
        def check():
            nonlocal calls
            calls+=1
            if calls==2:raise TimeoutError('original deadline')
        with self.assertRaises(TimeoutError):self.capture(fn,fn,lineno=3,check=check)
    def test_read_observer_filters_write_and_foreign_paths(self):
        t=b.ReadTrace(Path('/owned/tree'),lambda:None);t.active=True
        t.hook('open',('/owned/tree/a',None,os.O_RDONLY));t.hook('open',('/owned/tree/b',None,os.O_WRONLY));t.hook('open',('/foreign/a',None,os.O_RDONLY))
        self.assertEqual(t.finish(),('a',))
    def test_read_observer_sticky_caps(self):
        t=b.ReadTrace(Path('/owned/tree'),lambda:None);t.active=True
        for _ in range(4096):t.hook('open',('/owned/tree/a',None,os.O_RDONLY))
        with self.assertRaisesRegex(ValueError,'bounded'):t.hook('open',('/owned/tree/b',None,os.O_RDONLY))
        t.reset()
        with self.assertRaisesRegex(ValueError,'observer'):t.finish()
    def test_bootstrap_rejects_missing_symlink_fifo_hardlink_and_digest(self):
        with tempfile.TemporaryDirectory(prefix='tiny-case-bootstrap-',dir=Path(tempfile.gettempdir()).resolve())as name:
            d=Path(name);f=d/'mutation.py';raw=b'bounded';wanted=hashlib.sha256(raw).hexdigest()
            with mock.patch.object(b,'HERE',d):
                with self.assertRaises(OSError):b.sibling('mutation.py',wanted,lambda:None)
                f.write_bytes(raw);self.assertEqual(b.sibling('mutation.py',wanted,lambda:None),raw)
                with self.assertRaises(ValueError):b.sibling('mutation.py','0'*64,lambda:None)
                os.link(f,d/'linked')
                with self.assertRaises(ValueError):b.sibling('mutation.py',wanted,lambda:None)
                f.unlink();f.symlink_to(d/'linked')
                with self.assertRaises(OSError):b.sibling('mutation.py',wanted,lambda:None)
                f.unlink();os.mkfifo(f)
                with self.assertRaises(ValueError):b.sibling('mutation.py',wanted,lambda:None)
    def test_pinned_locus_sources_declared_in_baseline(self):
        for label,row in self.spec['assertions'].items():
            profile='stored638'if label.startswith('stored_')else'a2_669'
            self.assertEqual(row['source_sha256'],self.spec['profiles'][profile]['members'][row['path']]['sha256'])
        self.assertEqual(len(self.spec['current656']),656)
        self.assertEqual(len(self.spec['profiles']['stored638']['members']),639)
        self.assertEqual(len(self.spec['profiles']['a2_669']['members']),669)
    def test_expansion_metadata_totals_and_exact_keys(self):
        for profile,count,total in [('stored638',18,1848438),('a2_669',11,1669170)]:
            baseline=self.spec['profiles'][profile]['members'];new={k:v for k,v in self.spec['current656'].items()if k not in baseline}
            self.assertEqual(len(new),count);self.assertEqual(sum(x['bytes']for x in new.values()),total)
    def test_no_target_global_patch_or_module_removal(self):
        source=(HERE/'boundary_cases.py').read_text();tree=ast.parse(source)
        self.assertNotIn('mock.patch',source)
        for node in ast.walk(tree):
            if isinstance(node,ast.Delete):self.fail('no module removal or target mutation through del')
            if isinstance(node,ast.Call)and isinstance(node.func,ast.Name):self.assertNotIn(node.func.id,('setattr','delattr'))


    def test_declaration_matches_published_authorities_without_target_import(self):
        import json
        root=HERE.parents[3]
        for name,meta in self.spec['authorities'].items():
            raw=(root/name).read_bytes();self.assertEqual(len(raw),meta['bytes']);self.assertEqual(hashlib.sha256(raw).hexdigest(),meta['sha256'])
        published=json.loads((root/'tests/controlled-drugs/harness/historical-manifest.json').read_text())
        for profile,entry in self.spec['profiles'].items():
            self.assertEqual(entry['members'],{k:published['files'][k]for k in published['profiles'][profile]['paths']})
        for row in self.spec['assertions'].values():
            raw=(root/row['path']).read_bytes();self.assertEqual(hashlib.sha256(raw).hexdigest(),row['source_sha256'])
            nodes=[n for n in ast.walk(ast.parse(raw))if isinstance(n,ast.Assert)and n.lineno==row['lineno']]
            self.assertEqual(len(nodes),1);self.assertEqual(hashlib.sha256(ast.dump(nodes[0],include_attributes=False).encode()).hexdigest(),row['assertion_AST_sha256'])

    def test_tiny_helper_refusal_and_restoration_composition(self):
        m=b.load_mutation(lambda:None)
        with tempfile.TemporaryDirectory(prefix='tiny-composed-case-',dir=Path(tempfile.gettempdir()).resolve())as name:
            root=Path(name);tree=root/'tree';tree.mkdir();evidence=root/'evidence';evidence.mkdir();(tree/'one').write_bytes(b'good');st=tree.stat()
            baseline={'one':{'bytes':4,'sha256':hashlib.sha256(b'good').hexdigest()}}
            o=m.Mutation(tree,evidence,baseline,{},(st.st_dev,st.st_ino),lambda:None)
            try:
                o.symlink_same_bytes('one');self.assertTrue(o.verify_mutated()['verified'])
                fn=self.function('def target(path):\n    assert not path.is_symlink(), "fixed refusal"\n')
                self.capture(lambda:fn(tree/'one'),fn)
                self.assertTrue(o.verify_mutated()['verified']);self.assertTrue(o.restore()['restored'])
                fn(tree/'one');self.assertEqual((tree/'one').read_bytes(),b'good')
            finally:o.close()

    def test_tiny_helper_setup_error_cannot_satisfy_expected_target(self):
        m=b.load_mutation(lambda:None)
        with tempfile.TemporaryDirectory(prefix='tiny-callback-case-',dir=Path(tempfile.gettempdir()).resolve())as name:
            root=Path(name);tree=root/'tree';tree.mkdir();evidence=root/'evidence';evidence.mkdir();(tree/'one').write_bytes(b'good');st=tree.stat()
            o=m.Mutation(tree,evidence,{'one':{'bytes':4,'sha256':hashlib.sha256(b'good').hexdigest()}},{},(st.st_dev,st.st_ino),lambda:None)
            try:
                fn=self.function('def target(callback):\n    callback()\n    assert False, "fixed refusal"\n')
                with self.assertRaisesRegex(ValueError,'undeclared'):self.capture(lambda:fn(lambda:o.remove('unknown')),fn,lineno=3)
                self.assertTrue(o.failed);self.assertEqual((tree/'one').read_bytes(),b'good')
            finally:o.close()

if __name__=='__main__':unittest.main()
