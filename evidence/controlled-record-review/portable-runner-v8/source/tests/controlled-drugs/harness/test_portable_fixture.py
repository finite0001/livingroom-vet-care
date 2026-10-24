"""Pure portable source tests; repository root supplied explicitly, no private data."""
from pathlib import Path
import copy
import importlib.util
import json
import os
import sys
import tempfile
import time
import unittest
from types import SimpleNamespace
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('portable_stored_generator_tests',HERE/'portable_generator.py')
g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
p=g.portable
# Harness root is explicit, not hidden discovery/fallback. The integration runner
# supplies --repository-root; local source review uses the same argument.
ROOT=None


class PortableFixtureTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if ROOT is None:raise ValueError('explicit --repository-root required')
        cls.root=ROOT
        cls.stages,cls.inventory=g.compile_stages(ROOT)
        cls.cases,cls.renders,cls.inputs=g.load_inputs(ROOT)
        cls.legacy=p.legacy_inventory(ROOT)
        cls.env=p.envelope()

    def test_real93_regeneration_exact_full_parity(self):
        self.assertEqual(len(self.stages),93)
        self.assertTrue(p.verify_parity(self.root,self.stages,self.inventory))
        self.assertEqual(sum(len(s.encode())for s in self.stages.values()),33427253)
        self.assertEqual(self.inventory['case_inventory'],self.legacy['case_inventory'])
        self.assertEqual(self.inventory['complete_expected_outcomes'],self.legacy['complete_expected_outcomes'])
        self.assertEqual(self.inventory['render_inventory'],self.legacy['render_inventory'])

    def test_real_loader_fixed93_134inputs_exact1727(self):
        stages,inventory,wanted,inputs=p.load_fixture(self.root)
        self.assertEqual(stages,self.stages);self.assertEqual(inventory,self.inventory)
        self.assertEqual(len(inputs),134);self.assertEqual(len(wanted),1727)
        self.assertFalse(inventory['portable_provenance']['legacy_full761_admission'])
        self.assertFalse(inventory['portable_provenance']['historical_runtime_acceptance_inherited'])

    def test_only_three_inventory_provenance_fields_differ(self):
        changed={k for k in set(self.inventory)|set(self.legacy)if self.inventory.get(k)!=self.legacy.get(k)}
        self.assertEqual(changed,{'kind','source_hashes','portable_provenance'})
        self.assertEqual(self.inventory['kind'],'portable-stored-record-fixture-source-v1')
        self.assertEqual(self.legacy['kind'],'private-record-fixture-source-draft-v1')

    def test_case_literals_scale_and_SQLNULL_preserved(self):
        self.assertEqual(len(self.cases),1594);self.assertEqual(len(self.renders),1788)
        self.assertEqual(sum(c['expected']['outcome']=='success'for c in self.cases),204)
        self.assertEqual(sum(c['argument_kind']=='sql_null'for c in self.cases),4)
        by_id={c['id']:c for c in self.cases}
        self.assertIn('"version": 1.0',by_id['primitive/Q/version-visible-fraction']['argument_jsonb_text'])
        self.assertIn('"version": 3.0',by_id['primitive/pair/receipt-version-visible-fraction']['argument_jsonb_text'])

    def test_no_private_or_log_payload_authorities(self):
        for name in self.env['fixed_source_files']:
            self.assertTrue(name.startswith('tests/'));self.assertNotIn('/tmp/',name);self.assertFalse(name.endswith('.log'))
        self.assertEqual(len(self.env['excluded_legacy_authorities']),7)
        self.assertEqual(sum(x['source_path'].endswith('.log')for x in self.env['excluded_legacy_authorities']),5)
        self.assertEqual(set(self.env['fixed_source_files']),set(self.inputs))
        for name in self.inputs:self.assertTrue(name.startswith('tests/'))

    def test_envelope_missing_extra_duplicate_phases_refuse(self):
        for mutate in (lambda d:d.pop('version'),lambda d:d.update(extra=True),lambda d:d['phase_names'].__setitem__(1,d['phase_names'][0])):
            value=copy.deepcopy(self.env);mutate(value)
            with self.assertRaises(ValueError):p.validate_envelope_shape(value)

    def test_envelope_boolean_integer_confusions_refuse(self):
        for key,value in [('version',True),('source_only',1),('source_file_count',130.0),('legacy_full761_admission',0)]:
            bad=copy.deepcopy(self.env);bad[key]=value
            with self.assertRaises(ValueError):p.validate_envelope_shape(bad)
        bad=copy.deepcopy(self.env);first=next(iter(bad['fixed_source_files']));bad['fixed_source_files'][first]['bytes']=True
        with self.assertRaises(ValueError):p.validate_envelope_shape(bad)

    def test_envelope_private_path_absolute_and_traversal_refuse(self):
        for path in ('tmp/private/receipt.json','/tmp/private.json','tests/../private.json','tests/x.log'):
            bad=copy.deepcopy(self.env);key=next(iter(bad['fixed_source_files']));bad['fixed_source_files'][path]=bad['fixed_source_files'].pop(key)
            with self.assertRaises(ValueError):p.validate_envelope_shape(bad)

    def test_envelope_changed_bytes_rejected_at_actual_entry(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d).resolve();value=copy.deepcopy(self.env);value['legacy_provenance']['original_complete_sources']=762
            (root/'portable-envelope.json').write_text(json.dumps(value))
            with patch.object(p,'HERE',root),self.assertRaisesRegex(ValueError,'pinned source digest'):p.envelope()

    def test_duplicate_JSON_keys_refuse(self):
        with self.assertRaisesRegex(ValueError,'duplicate JSON key'):json.loads('{"version":1,"version":1}',object_pairs_hook=p.unique)

    def mutated_case(self,key,value,index=None):
        index=next(i for i,c in enumerate(self.cases)if c['argument_kind']=='jsonb')if index is None else index
        result=list(self.cases);result[index]=copy.deepcopy(result[index]);result[index][key]=value;return result

    def test_case_wrong_type_tag_dispatch_and_duplicate_refuse(self):
        for key,value in [('argument_utf8_bytes',True),('argument_jsonb_text',{}),('function','unapproved'),('argument_kind','null')]:
            with self.assertRaises(ValueError):p.validate_cases(self.mutated_case(key,value))
        bad=list(self.cases);bad[1]=bad[0]
        with self.assertRaisesRegex(ValueError,'case ID'):p.validate_cases(bad)

    def test_case_primary_error_and_SQLNULL_shape_refuse(self):
        index=next(i for i,c in enumerate(self.cases)if c['expected']['outcome']=='error')
        bad=list(self.cases);bad[index]=copy.deepcopy(bad[index]);bad[index]['expected']['sqlstate']='23505'
        with self.assertRaises(ValueError):p.validate_cases(bad)
        index=next(i for i,c in enumerate(self.cases)if c['argument_kind']=='sql_null')
        with self.assertRaisesRegex(ValueError,'SQLNULL'):p.validate_cases(self.mutated_case('argument_jsonb_text','null',index))

    def test_literal_corpus_changed_same_size_rejected(self):
        raw=b'{"synthetic":true}';meta={'bytes':len(raw),'sha256':p.sha(raw)}
        with tempfile.TemporaryDirectory()as d:
            root=Path(d).resolve();file=root/'literal.json';file.write_bytes(raw)
            self.assertEqual(p.read_regular(root,'literal.json',meta),raw)
            file.write_bytes(raw.replace(b'true',b'nulL'))
            with self.assertRaisesRegex(ValueError,'pinned source digest'):p.read_regular(root,'literal.json',meta)

    def test_symlink_member_parent_and_size_cap_refuse(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d).resolve();raw=b'x';meta={'bytes':1,'sha256':p.sha(raw)};(root/'real').mkdir();(root/'real/x').write_bytes(raw)
            (root/'linked').symlink_to(root/'real',target_is_directory=True)
            with self.assertRaisesRegex(ValueError,'physical source'):p.read_regular(root,'linked/x',meta)
            (root/'linked-file').symlink_to(root/'real/x')
            with self.assertRaisesRegex(ValueError,'physical source'):p.read_regular(root,'linked-file',meta)
            with self.assertRaisesRegex(ValueError,'size/hash'):p.read_regular(root,'real/x',{'bytes':p.MAX_FILE+1,'sha256':meta['sha256']})

    def test_deadline_reaches_each_source_read(self):
        first=next(iter(self.env['fixed_source_files']));meta=self.env['fixed_source_files'][first]
        with self.assertRaises(TimeoutError):p.read_regular(self.root,first,meta,time.monotonic()-1)
        with self.assertRaises(TimeoutError):p.load_fixture(self.root,time.monotonic()-1)

    def test_own_sources_and_envelope_deadlines_and_caps(self):
        with self.assertRaises(TimeoutError):p.envelope(time.monotonic()-1)
        with self.assertRaises(TimeoutError):p.own_inputs(self.root,time.monotonic()-1)
        with tempfile.TemporaryDirectory()as d:
            root=Path(d).resolve()
            for name in p.OWN_FILES:(root/name).write_bytes((HERE/name).read_bytes())
            with patch.object(p,'HERE',root):
                self.assertEqual(len(p.own_inputs(root)),4)
                (root/'portable_loader.py').write_bytes(b'x'*(p.MAX_ENVELOPE+1))
                with self.assertRaisesRegex(ValueError,'bounded'):p.own_inputs(root)
                (root/'portable-envelope.json').write_bytes(b'x'*(p.MAX_ENVELOPE+1))
                with self.assertRaisesRegex(ValueError,'bounded regular'):p.envelope()

    def test_missing_corpus_never_falls_back_to_private_data(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d).resolve()
            with self.assertRaises(FileNotFoundError):p.load_fixture(root)
            with self.assertRaises(FileNotFoundError):g.load_inputs(root)

    def test_SQL_changed_type_order_and_bytes_refuse(self):
        name=next(iter(self.stages))
        for value in (self.stages[name]+'\n',self.stages[name].encode()):
            bad=dict(self.stages);bad[name]=value
            with self.assertRaises(ValueError):p.verify_parity(self.root,bad,self.inventory)
        bad=dict(reversed(list(self.stages.items())))
        with self.assertRaises(ValueError):p.verify_parity(self.root,bad,self.inventory)

    def test_inventory_semantic_or_type_mutations_refuse(self):
        for key,value in [('source_only',1),('target_cases',1594.0),('whole_seconds',601),('byte_guard_branch_proof',True)]:
            bad=dict(self.inventory);bad[key]=value
            with self.assertRaises(ValueError):p.verify_parity(self.root,self.stages,bad)

    def test_input_keyset_missing_extra_or_digest_refuse(self):
        for action in ('missing','extra','digest'):
            bad=dict(self.inventory);inputs=dict(bad['source_hashes']);key=next(iter(inputs))
            if action=='missing':del inputs[key]
            elif action=='extra':inputs['tests/unreviewed.py']='0'*64
            else:inputs[key]='0'*64
            bad['source_hashes']=inputs
            with self.assertRaises(ValueError):p.verify_parity(self.root,self.stages,bad)

    def test_full_outcome_and_render_inventory_mutation_refuse(self):
        bad=dict(self.inventory);out=dict(bad['complete_expected_outcomes']);out.pop(next(iter(out)));bad['complete_expected_outcomes']=out
        with self.assertRaises(ValueError):p.verify_parity(self.root,self.stages,bad)
        bad=dict(self.inventory);renders=list(bad['render_inventory']);renders[0]=dict(renders[0]);renders[0]['raw']+=' ';bad['render_inventory']=renders
        with self.assertRaises(ValueError):p.verify_parity(self.root,self.stages,bad)

    def test_foreign_observer_is_refused_not_overwritten(self):
        foreign=SimpleNamespace(__file__='/nonexistent/foreign/canonical_post206.py')
        with patch.dict(sys.modules,{'canonical_post206':foreign}):
            with self.assertRaisesRegex(ValueError,'observer import shadowing'):g.observer_source(self.root)
            self.assertIs(sys.modules['canonical_post206'],foreign)

    def test_unused_writer_removed_no_output_API(self):
        self.assertFalse(hasattr(g,'write_new'))
        tree=__import__('ast').parse((HERE/'portable_generator.py').read_text())
        forbidden={'write_bytes','write_text','mkdir','makedirs','rename','unlink'}
        self.assertFalse(any(isinstance(n,__import__('ast').Call)and isinstance(n.func,__import__('ast').Attribute)and n.func.attr in forbidden for n in __import__('ast').walk(tree)))

    def test_source_only_CLI_refuses_without_compiling_or_writing(self):
        with patch.object(g,'compile_stages',side_effect=AssertionError('must not compile')),patch.object(Path,'mkdir',side_effect=AssertionError('must not write')),self.assertRaisesRegex(SystemExit,'Source-only library'):g.main()

    def test_deadline_nan_infinity_bool_and_expiry_refused(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d).resolve();raw=b'x';(root/'x').write_bytes(raw);meta={'bytes':1,'sha256':p.sha(raw)}
            for deadline in (float('nan'),float('inf'),-float('inf'),True,False,0,-1,'123',10**500):
                with self.subTest(deadline=deadline),self.assertRaises(ValueError):p.read_regular(root,'x',meta,deadline)
            with self.assertRaises(TimeoutError):p.read_regular(root,'x',meta,time.monotonic()-1)
            self.assertEqual(p.read_regular(root,'x',meta,None),raw)
            self.assertEqual(p.read_regular(root,'x',meta,time.monotonic()+2),raw)

    def test_root_ancestor_symlink_refused(self):
        with tempfile.TemporaryDirectory()as d:
            home=Path(d).resolve();(home/'real/child').mkdir(parents=True);(home/'real/child/x').write_bytes(b'x');(home/'alias').symlink_to(home/'real',target_is_directory=True)
            with self.assertRaisesRegex(ValueError,'physical source'):p.read_regular(home/'alias/child','x',{'bytes':1,'sha256':p.sha(b'x')})
            with patch.object(p,'HERE',home/'alias/child'),self.assertRaisesRegex(ValueError,'physical source'):p.envelope()

    def test_leaf_swapped_to_symlink_before_open_refused(self):
        with tempfile.TemporaryDirectory()as d:
            home=Path(d).resolve();root=home/'root';root.mkdir();leaf=root/'x';leaf.write_bytes(b'x');original=os.open;swapped=[]
            def opening(name,flags,*args,**kwargs):
                if name=='x'and not flags&os.O_DIRECTORY and not swapped:
                    leaf.rename(home/'outside');leaf.symlink_to(home/'outside');swapped.append(True)
                return original(name,flags,*args,**kwargs)
            with patch.object(os,'open',side_effect=opening),self.assertRaisesRegex(ValueError,'physical source'):p.read_regular(root,'x',{'bytes':1,'sha256':p.sha(b'x')})
            self.assertTrue(swapped);self.assertEqual((home/'outside').read_bytes(),b'x')

    def test_parent_replaced_after_open_refuses_held_descriptor_bytes(self):
        with tempfile.TemporaryDirectory()as d:
            home=Path(d).resolve();root=home/'root';root.mkdir();(root/'x').write_bytes(b'x');original=os.read;swapped=[]
            def reading(fd,size):
                if not swapped:
                    root.rename(home/'moved');root.symlink_to(home/'moved',target_is_directory=True);swapped.append(True)
                return original(fd,size)
            with patch.object(os,'read',side_effect=reading),self.assertRaisesRegex(ValueError,'ancestor identity'):p.read_regular(root,'x',{'bytes':1,'sha256':p.sha(b'x')})
            self.assertTrue(swapped)

    def test_fifo_and_directory_leaf_refuse_without_blocking(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d).resolve();os.mkfifo(root/'fifo');(root/'directory').mkdir();meta={'bytes':1,'sha256':p.sha(b'x')};started=time.monotonic()
            for name in ('fifo','directory'):
                with self.assertRaisesRegex(ValueError,'bounded regular'):p.read_regular(root,name,meta,started+2)
            self.assertLess(time.monotonic()-started,2)
            os.mkfifo(root/'portable-envelope.json')
            with patch.object(p,'HERE',root),self.assertRaisesRegex(ValueError,'bounded regular'):p.envelope(started+2)

    def test_opened_regular_leaf_changed_to_same_bytes_new_inode_refuses(self):
        with tempfile.TemporaryDirectory()as d:
            root=Path(d).resolve();(root/'x').write_bytes(b'x');original=os.read;swapped=[]
            def reading(fd,size):
                if not swapped:
                    (root/'x').rename(root/'retained');(root/'x').write_bytes(b'x');swapped.append(True)
                return original(fd,size)
            with patch.object(os,'read',side_effect=reading),self.assertRaisesRegex(ValueError,'opened source changed during read|source leaf identity changed'):p.read_regular(root,'x',{'bytes':1,'sha256':p.sha(b'x')})



if __name__=='__main__':
    if len(sys.argv)<3 or sys.argv[1]!='--repository-root':raise SystemExit('Supply explicit --repository-root PATH')
    ROOT=Path(sys.argv[2]).resolve();del sys.argv[1:3]
    unittest.main(verbosity=2)
