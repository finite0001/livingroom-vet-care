"""Offline runtime contract tests; no database realization."""
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parents[2]/'tests/controlled-drugs/engine/candidate'

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

r=load('configuration_runtime_draft',HERE/'record_review_v3_configuration_runtime.py')
session=load('configuration_session_draft',HERE/'record_review_v3_configuration_session.py')
gen=load('configuration_fixture_generator_draft',HERE/'record_review_v3_configuration_fixtures.py')


def good_summary(wanted):
    proof={name:dict(outcome=outcome,detail={})for name,outcome in wanted.items()}
    for name in ('nul_escape','unpaired_surrogate'):
        proof[name]['detail']=dict(sqlstate='22P05',message='unsupported Unicode escape sequence',decoded=None,target_called=False)
    return dict(kind='private-configuration-input-observations-v1',acceptance=False,publication=False,auth_acceptance=False,clinical_activation=False,proof=proof)


def receipt_output(wanted):
    backend=dict(pid=123,backend_start='2026-10-22T00:00:00.000001Z')
    receipt=dict(passed=True,client_returncode=0,nonce='a'*32,backend=backend,phases=[dict(name=n,complete=True)for n in r.PHASE_NAMES])
    markers=[{session.MARKER:dict(nonce=receipt['nonce'],index=i-1,name='identity'if i==0 else r.PHASE_NAMES[i-1],backend_pid=123,backend_start=backend['backend_start'])}for i in range(26)]
    output='\n'.join(json.dumps(x)for x in markers+[good_summary(wanted)])+'\n'
    return receipt,output


class RuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stages,cls.inventory=gen.compile_stages();cls.raw=gen.CORPUS.read_bytes()
        cls.wanted=r.admit_fixture(cls.stages,cls.inventory,cls.raw)

    def test_private_location_cannot_launch_before_resource_import(self):
        r.canonical_location()
        with tempfile.TemporaryDirectory()as tmp,patch.object(r,'SOURCE',Path(tmp)):
            with self.assertRaisesRegex(AssertionError,'Private draft cannot launch'):r.canonical_location()
        source=(HERE/'record_review_v3_configuration_runtime.py').read_text()
        self.assertLess(source.index('    canonical_location()'),source.index('    import record_review_v3_gate_b_runtime'))
        self.assertNotIn('--reviewed-source-map',source)

    def test_stage_contract_and_556_authoritative_outcomes(self):
        self.assertEqual(r.PHASE_NAMES,session.PHASE_NAMES)
        self.assertEqual(len(self.wanted),556)
        self.assertEqual(sum(v=='23514_configuration_invalid'for v in self.wanted.values()),418)
        self.assertEqual(sum(v=='unchanged'for v in self.wanted.values()),70)
        for mutation in ('missing_phase','phase_hash','extra_proof','wrong_outcome','corpus'):
            stages=deepcopy(self.stages);inventory=deepcopy(self.inventory);raw=self.raw
            if mutation=='missing_phase':del stages['positive_000']
            if mutation=='phase_hash':stages['positive_000']+='\n'
            if mutation=='extra_proof':inventory['complete_expected_outcomes']['extra']='unchanged'
            if mutation=='wrong_outcome':inventory['complete_expected_outcomes']['sql_null_argument']='unchanged'
            if mutation=='corpus':raw+=b' '
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):r.admit_fixture(stages,inventory,raw)

    def test_only_integrated_fixture_and_integer_budgets_are_admitted(self):
        for flag in (False,1,'true',None):
            inventory=deepcopy(self.inventory);inventory['source_integration']=flag
            with self.subTest(flag=flag),self.assertRaises(AssertionError):r.admit_fixture(self.stages,inventory,self.raw)
        for key in ('phase_seconds','whole_seconds','emergency_cleanup_seconds'):
            inventory=deepcopy(self.inventory);inventory[key]=float(inventory[key])
            with self.subTest(key=key),self.assertRaises(AssertionError):r.admit_fixture(self.stages,inventory,self.raw)

    def test_summary_exact_keys_types_and_no_decoder_23514_credit(self):
        self.assertEqual(r.admit_summary(good_summary(self.wanted),self.wanted)['acceptance'],False)
        for mutation in ('missing','extra','bool_false','wrong_outcome','extra_detail','decoder_target','decoder23514','decoder_success_message','long_message','top_extra'):
            value=good_summary(self.wanted)
            if mutation=='missing':del value['proof']['sql_null_argument']
            if mutation=='extra':value['proof']['extra']={'outcome':'unchanged','detail':{}}
            if mutation=='bool_false':value['acceptance']=0
            if mutation=='wrong_outcome':value['proof']['sql_null_argument']['outcome']='decoder_observation_only'
            if mutation=='extra_detail':value['proof']['sql_null_argument']['detail']={'hidden':True}
            if mutation=='decoder_target':value['proof']['nul_escape']['detail']['target_called']=0
            if mutation=='decoder23514':value['proof']['nul_escape']['detail']['sqlstate']='23514'
            if mutation=='decoder_success_message':value['proof']['nul_escape']['detail']['sqlstate']=None
            if mutation=='long_message':value['proof']['nul_escape']['detail']['message']='x'*1025
            if mutation=='top_extra':value['secret']='not permitted'
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):r.admit_summary(value,self.wanted)

    def test_output_markers_and_final_summary_full_keysets(self):
        receipt,output=receipt_output(self.wanted)
        r.parse_output(output,receipt,self.wanted,session.MARKER)
        for mutation in ('missing_marker','extra_marker','extra_result','unknown_text','duplicate_key','boolean_return','backend'):
            proof=deepcopy(receipt);raw=output
            if mutation=='missing_marker':raw='\n'.join(raw.splitlines()[1:])
            if mutation=='extra_marker':raw+=raw.splitlines()[0]+'\n'
            if mutation=='extra_result':raw+='{}\n'
            if mutation=='unknown_text':raw+='unexplained result\n'
            if mutation=='duplicate_key':raw=raw.replace('"acceptance": false','"acceptance": false,"acceptance": false',1)
            if mutation=='boolean_return':proof['client_returncode']=False
            if mutation=='backend':raw=raw.replace('"backend_pid": 123','"backend_pid": 124',1)
            with self.subTest(mutation=mutation),self.assertRaises((AssertionError,ValueError)):r.parse_output(raw,proof,self.wanted,session.MARKER)

    def test_complete_source_and_saved_keyset_drift_refused(self):
        with tempfile.TemporaryDirectory()as tmp:
            root=Path(tmp)/'source';root.mkdir();folder=Path(tmp)/'evidence';saved=folder/'executed-inputs';saved.mkdir(parents=True)
            (root/'a.py').write_text('one');(saved/'a.py').write_text('one');expected={'a.py':r.sha(b'one')}
            r.verify_saved(folder,expected,root,expected);r.bind_inputs(expected,expected,root)
            with self.assertRaises(AssertionError):r.bind_inputs({'missing.py':'0'*64},expected,root)
            with self.assertRaises(AssertionError):r.bind_inputs({'../escape':'0'*64},{'../escape':'0'*64},root)
            for mutant in ({},dict(expected,extra='0'*64),{'a.py':'0'*64}):
                with self.assertRaises(AssertionError):r.verify_saved(folder,expected,root,mutant)
            (saved/'extra.py').write_text('extra')
            with self.assertRaises(AssertionError):r.verify_saved(folder,expected,root,expected)
            (saved/'extra.py').unlink();(saved/'a.py').unlink();(saved/'a.py').symlink_to(root/'a.py')
            with self.assertRaises(AssertionError):r.verify_saved(folder,expected,root,expected)

    def test_source_symlink_refused(self):
        with tempfile.TemporaryDirectory()as tmp:
            root=Path(tmp);(root/'plain').write_text('one');(root/'link').symlink_to(root/'plain')
            with self.assertRaises(AssertionError):r.regular_sources({'link':r.sha(b'one')},root)

    def test_cleanup_or_deadline_failure_cannot_be_pass(self):
        self.assertTrue(r.completion(True,None,True,599,600))
        for args in [(False,None,True,1,600),(True,'cleanup failed',True,1,600),(True,None,False,1,600),(True,None,1,1,600),(True,None,True,600,600),(True,None,True,float('nan'),600)]:
            self.assertFalse(r.completion(*args))

    def test_separate_engine_preserves_safety_core_with_only_declared_diff(self):
        source=(gen.CANDIDATE/'record_review_v3_phased_session.py').read_text()
        source=source.replace('bounded eight-phase psql session','bounded25-phase ordinary-postgres psql session').replace('Run eight source-declared phases','Run25 fixed configuration-input phases')
        start=source.index('PHASE_NAMES = ');end=source.index('\nPHASE_SECONDS',start)
        source=source[:start]+'PHASE_NAMES = '+repr(r.PHASE_NAMES)+source[end:]
        source=source.replace("MARKER = 'lrv_gate_b_phase_marker'","MARKER = 'lrv_configuration_input_phase_marker'").replace("kind='gate-b-phased-session-v2'","kind='configuration-input-phased-session-v1'").replace("'-U', 'supabase_admin'","'-U', 'postgres'")
        self.assertEqual(source,(HERE/'record_review_v3_configuration_session.py').read_text())

    def test_real_session_admission_counter_preserves_receipt_location(self):
        with tempfile.TemporaryDirectory()as tmp:
            runtime=SimpleNamespace(folder=Path(tmp),command_number=0,deadline=time.monotonic()+120,
                cleanup_deadline=None,candidate_phase_deadline=None,container='a'*64,
                endpoint='unix:///inert-test.sock',log=io.StringIO(),
                query=lambda sql:json.dumps({'metadata':'expected'}),check_config=lambda:None,
                docker=lambda argv:argv)
            def verify():
                runtime.command_number+=1
                return {'Id':runtime.container}
            runtime.verify=verify
            receipt,output=receipt_output(self.wanted)
            def execute(actual_session):
                argv,_,_=actual_session.admit()
                self.assertEqual(argv[argv.index('-U')+1],'postgres')
                self.assertEqual(runtime.command_number,2)
                actual_session.receipt.update(receipt)
                session._save(actual_session.folder,'receipt.json',receipt)
                return output
            unchanged={'rows':{},'catalog':{}};snapshots=iter([unchanged,unchanged])
            capture=SimpleNamespace(snapshot=lambda query:next(snapshots),parse=json.loads)
            saved={};owned=SimpleNamespace(save=lambda folder,name,value:saved.update({name:value}))
            package=dict(snapshot_sql='select metadata',expected={'metadata':'expected'})
            with patch.object(session._Session,'execute',execute):
                result=r.diagnostic(runtime,package,self.stages,self.inventory,self.wanted,session,owned,capture)
            self.assertEqual(result['proof_ids'],556)
            self.assertTrue((runtime.folder/'0001-phased-session/receipt.json').is_file())
            self.assertFalse((runtime.folder/'0002-phased-session').exists())
            self.assertEqual(set(saved),{'configuration-before','configuration-after','configuration-observations'})

    def test_diagnostic_requires_full_before_after_preservation(self):
        for drift in (False,True):
            with self.subTest(drift=drift),tempfile.TemporaryDirectory()as tmp:
                runtime=SimpleNamespace(folder=Path(tmp),command_number=0,query=lambda sql:json.dumps({'metadata':'expected'}))
                receipt,output=receipt_output(self.wanted)
                def run(rt,phases):
                    self.assertTrue(phases[0][1].startswith(r.OWNER_SQL))
                    self.assertEqual(len(phases),25)
                    rt.command_number+=1;path=rt.folder/'0001-phased-session';path.mkdir();(path/'receipt.json').write_text(json.dumps(receipt));return output
                before={'rows':{'private':[]},'catalog':{'function':'unchanged'}};after=deepcopy(before)
                if drift:after['rows']['private'].append({'forbidden':True})
                snapshots=iter([before,after]);capture=SimpleNamespace(snapshot=lambda query:next(snapshots),parse=json.loads)
                owned=SimpleNamespace(save=lambda folder,name,value:None)
                phased=SimpleNamespace(run=run,MARKER=session.MARKER)
                package=dict(snapshot_sql='select metadata',expected={'metadata':'expected'})
                if drift:
                    with self.assertRaises(AssertionError):r.diagnostic(runtime,package,self.stages,self.inventory,self.wanted,phased,owned,capture)
                else:self.assertEqual(r.diagnostic(runtime,package,self.stages,self.inventory,self.wanted,phased,owned,capture)['proof_ids'],556)


if __name__=='__main__':unittest.main(verbosity=2)
