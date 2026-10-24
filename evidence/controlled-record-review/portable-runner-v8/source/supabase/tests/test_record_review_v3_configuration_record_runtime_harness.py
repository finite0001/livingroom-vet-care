"""Offline contract/real callback tests. Never Docker, PostgreSQL or network."""
from copy import deepcopy
import importlib.util
import io
import json
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace, ModuleType
from contextlib import ExitStack
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
ROOT=HERE.parents[1]
CANDIDATE=ROOT/'tests/controlled-drugs/engine/candidate'

def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module

r=load('stored_runtime',CANDIDATE/'record_review_v3_configuration_record_runtime.py')
session=load('stored_session',CANDIDATE/'record_review_v3_configuration_record_session.py')
paused=load('unchanged_paused_bootstrap',CANDIDATE/'record_review_v3_paused_bootstrap.py')


def good_summary(wanted):
    return dict(kind='private-stored-configuration-value-observations-v1',acceptance=False,
                publication=False,auth_acceptance=False,clinical_activation=False,proof=dict(wanted))


def receipt_output(wanted):
    backend=dict(pid=123,backend_start='2026-10-22T00:00:00.000001Z')
    receipt=dict(passed=True,client_returncode=0,nonce='a'*32,backend=backend,
                 phases=[dict(name=n,complete=True)for n in r.PHASE_NAMES])
    markers=[{session.MARKER:dict(nonce=receipt['nonce'],index=i-1,
        name='identity'if i==0 else r.PHASE_NAMES[i-1],backend_pid=123,
        backend_start=backend['backend_start'])}for i in range(94)]
    return receipt,'\n'.join(json.dumps(x)for x in markers+[good_summary(wanted)])+'\n'


class FakeRuntime(r.DeadlineContract):
    def __init__(self):
        self.initialize_deadlines(time.monotonic()+600)
        self.cleanup_deadline=None
        self.bootstrap_phase_deadline=None
        self.candidate_phase_deadline=None


class RuntimeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stages,cls.inventory,cls.wanted,cls.inputs=r.load_fixture()

    def test_fixed_pinned_93_stages_1594_cases_1727_outcomes(self):
        self.assertEqual(r.PHASE_NAMES,session.PHASE_NAMES)
        self.assertEqual(len(self.stages),93);self.assertEqual(len(self.wanted),1727)
        self.assertEqual(len(self.inventory['case_inventory']),1594)
        self.assertEqual(sum(len(v.encode())for v in self.stages.values()),33427253)
        self.assertTrue(all(self.inputs.get(str((r.FIXTURE/'sql-v1'/('%03d-'%i+n+'.sql')).relative_to(ROOT)))==self.inventory['phases'][n]['sha256']for i,n in enumerate(r.PHASE_NAMES)))

    def test_source_report_cannot_launch_and_does_not_spawn_or_network(self):
        forbidden=AssertionError('Source report attempted process or network')
        with patch.object(subprocess,'Popen',side_effect=forbidden),patch.object(subprocess,'run',side_effect=forbidden),patch.object(socket,'socket',side_effect=forbidden):
            report=r.source_state();self.assertTrue(report['source_only']);self.assertFalse(report['runtime_executed'])
            with patch.object(r,'HERE',ROOT/'tmp/noncanonical-runtime-refusal-test'), self.assertRaisesRegex(AssertionError,'Private draft cannot launch'):r.execute_integrated()
            with patch.object(sys,'argv',['report','--run-synthetic-local']),self.assertRaisesRegex(AssertionError,'Source-only CLI'):r.main()
        source=(CANDIDATE/'record_review_v3_configuration_record_runtime.py').read_text()
        self.assertLess(source.index('    canonical_location()'),source.index('    import record_review_v3_gate_b_runtime'))

    def test_canonical_integration_preserves_frozen634_and_exact_closure(self):
        forbidden=AssertionError('Source integration attempted process or network')
        with patch.object(subprocess,'Popen',side_effect=forbidden),patch.object(subprocess,'run',side_effect=forbidden),patch.object(socket,'socket',side_effect=forbidden),patch.object(sys,'path',[str(CANDIDATE)]+sys.path):
            import record_review_v3_gate_a_runtime as owned
            import record_review_v3_configuration_record_profile as profile
            package=profile.build()
            r.canonical_location();r.admit_package(package)
            current=owned.source_inputs()
            baseline=json.loads(r.read_pinned(r.BASELINE,r.BASELINE_SHA))
            self.assertEqual(len(current),638)
            self.assertEqual({key:current[key] for key in baseline},baseline)
            full=r.source_inputs(owned,self.inputs,package)
            self.assertEqual(len(full),761)
            self.assertTrue(all(full[key]==value for key,value in current.items()))

    def test_fixed_fixture_refuses_edited_inventory_stage_source_pin(self):
        for key,value in [('phase_seconds',120.0),('whole_seconds',True),('absolute_cutoff_seconds_before_outer_deadline',59),('source_only',1),('runtime_executed',True),('target_cases',1593),('total_sql_bytes',0)]:
            bad=dict(self.inventory);bad[key]=value
            with self.subTest(key=key),self.assertRaises(AssertionError):r.admit_inventory(bad)
        for mutation in ('missingphase','extraoutcome','wrongoutcome','duplicatecase','wrongfunction','wrongprimary','wrongzone'):
            bad=deepcopy(self.inventory)
            if mutation=='missingphase':bad['phase_names']=bad['phase_names'][1:]
            if mutation=='extraoutcome':bad['complete_expected_outcomes']['extra']='literal_success'
            if mutation=='wrongoutcome':bad['complete_expected_outcomes'][next(iter(self.wanted))]='wrong'
            if mutation=='duplicatecase':bad['case_inventory'][1]=bad['case_inventory'][0]
            if mutation=='wrongfunction':bad['case_inventory'][0]['function']='untrusted_function'
            if mutation=='wrongprimary':next(c for c in bad['case_inventory']if c['expected']['outcome']=='error')['expected']['message']='wrong'
            if mutation=='wrongzone':bad['zones'].reverse()
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):r.admit_inventory(bad)
        with patch.object(r,'INVENTORY_SHA','0'*64),self.assertRaisesRegex(AssertionError,'pin'):r.load_fixture()
        with tempfile.TemporaryDirectory()as tmp:
            path=Path(tmp)/'changed.sql';path.write_text('select 1;')
            with self.assertRaisesRegex(AssertionError,'pin'):r.read_pinned(path,'0'*64)
            with self.assertRaises(AssertionError):r.read_pinned(path,r.sha(path.read_bytes()),limit=1)

    def test_full_summary_keys_types_and_flags(self):
        r.admit_summary(good_summary(self.wanted),self.wanted)
        for mutation in ('missing','extra','falseint','wrongoutcome','objectoutcome','extratop','kind'):
            value=good_summary(self.wanted);label=next(iter(self.wanted))
            if mutation=='missing':del value['proof'][label]
            if mutation=='extra':value['proof']['extra']='literal_success'
            if mutation=='falseint':value['acceptance']=0
            if mutation=='wrongoutcome':value['proof'][label]='wrong'
            if mutation=='objectoutcome':value['proof'][label]={'outcome':self.wanted[label]}
            if mutation=='extratop':value['runtime_acceptance']=True
            if mutation=='kind':value['kind']='different'
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):r.admit_summary(value,self.wanted)

    def test_full_marker_receipt_and_outcome_admission(self):
        receipt,output=receipt_output(self.wanted);r.parse_output(output,receipt,self.wanted,session.MARKER)
        for mutation in ('missingmarker','extraresult','duplicatekey','backend','boolreturn','incomplete','reordered','extramarker'):
            proof=deepcopy(receipt);raw=output
            if mutation=='missingmarker':raw='\n'.join(raw.splitlines()[1:])
            if mutation=='extraresult':raw+='{}\n'
            if mutation=='duplicatekey':raw=raw.replace('"acceptance": false','"acceptance": false,"acceptance": false')
            if mutation=='backend':raw=raw.replace('"backend_pid": 123','"backend_pid": 124',1)
            if mutation=='boolreturn':proof['client_returncode']=False
            if mutation=='incomplete':proof['phases'][-1]['complete']=False
            if mutation=='reordered':proof['phases'].reverse()
            if mutation=='extramarker':raw+=raw.splitlines()[0]+'\n'
            with self.subTest(mutation=mutation),self.assertRaises((AssertionError,ValueError)):r.parse_output(raw,proof,self.wanted,session.MARKER)

    def test_fixed_outer_setup_and_final_mode_gated_by_full_results_and_eof(self):
        runtime=FakeRuntime();outer=runtime.original_outer_deadline
        self.assertEqual(runtime.deadline,outer-60);self.assertLessEqual(runtime.remaining(600),120)
        receipt,output=receipt_output(self.wanted);summary=good_summary(self.wanted)
        for mutation in ('incomplete','exit','outcome','expired'):
            rt=FakeRuntime();proof=deepcopy(receipt);value=deepcopy(summary)
            if mutation=='incomplete':proof['phases'][-1]['complete']=False
            if mutation=='exit':proof['client_returncode']=7
            if mutation=='outcome':value['proof'].pop(next(iter(self.wanted)))
            if mutation=='expired':rt.measurement_deadline=time.monotonic()-1
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):rt.enter_final_proof(proof,value,self.wanted,output,session.MARKER)
            self.assertFalse(rt.final_proof)
        runtime.enter_final_proof(receipt,summary,self.wanted,output,session.MARKER)
        self.assertEqual(runtime.deadline,outer);self.assertTrue(runtime.final_proof)
        with self.assertRaises(AssertionError):runtime.enter_final_proof(receipt,summary,self.wanted,output,session.MARKER)

    def test_normal_cleanup_does_not_spend_emergency_or_reset_outer(self):
        runtime=FakeRuntime();outer=runtime.original_outer_deadline
        with self.assertRaises(AssertionError):runtime.prepare_cleanup(True)
        runtime=FakeRuntime();receipt,output=receipt_output(self.wanted)
        runtime.enter_final_proof(receipt,good_summary(self.wanted),self.wanted,output,session.MARKER)
        outer=runtime.original_outer_deadline;runtime.prepare_cleanup(True)
        self.assertEqual(runtime.cleanup_deadline,outer);self.assertEqual(runtime.deadline,outer)
        with self.assertRaisesRegex(AssertionError,'reset'):runtime.prepare_cleanup(False)

    def test_failure_child_and_runtime_share_single_existing_reserve(self):
        runtime=FakeRuntime();runtime.cleanup_deadline=time.monotonic()+42;original=runtime.cleanup_deadline
        runtime.prepare_cleanup(False)
        self.assertEqual(runtime.cleanup_deadline,original);self.assertEqual(runtime.deadline,original)
        self.assertEqual(runtime.record_cleanup_kind,'single_emergency_reserve')
        fresh=FakeRuntime();now=time.monotonic();fresh.prepare_cleanup(False)
        self.assertGreaterEqual(fresh.cleanup_deadline,now+180)
        self.assertLess(fresh.cleanup_deadline,now+180.1)

    def test_real_paused_delegated_command_and_drain_use_earlier_cutoff(self):
        # The actual retained PausedBootstrap.command bypasses an overriding
        # runtime.command. Its parent command still invokes this remaining().
        runtime=FakeRuntime();runtime.container='a'*64;runtime.verify=lambda:None
        runtime.original_outer_deadline=160.12;runtime.measurement_deadline=100.12;runtime.deadline=100.12
        clock=[100.0];observed=[];waits=[]
        helper=object.__new__(paused.PausedBootstrap);helper.runtime=runtime
        def parent(argv,text=None,timeout=120,fail=True):
            limit=runtime.remaining(timeout);observed.append(limit)
            return SimpleNamespace(stdout='f')
        helper.parent_command=parent
        def sleep(seconds):
            waits.append(seconds);self.assertLessEqual(seconds,100.12-clock[0]+1e-9);clock[0]+=seconds
        with patch.object(r.time,'monotonic',side_effect=lambda:clock[0]),patch.object(paused.time,'sleep',side_effect=sleep):
            helper.command(['test-only']);self.assertAlmostEqual(observed[0],.12)
            with self.assertRaisesRegex(AssertionError,'drain deadline'):helper.drain()
            self.assertAlmostEqual(clock[0],100.12)
            with self.assertRaisesRegex(AssertionError,'effective deadline'):helper.command(['test-only'])
        self.assertTrue(waits);self.assertIsNone(runtime.bootstrap_phase_deadline)
        self.assertEqual(runtime.original_outer_deadline,160.12)

    def test_real_admission_callback_counter_preserves_folder(self):
        with tempfile.TemporaryDirectory()as tmp:
            runtime=FakeRuntime();runtime.folder=Path(tmp);runtime.command_number=0
            runtime.container='a'*64;runtime.endpoint='unix:///inert.sock';runtime.log=io.StringIO()
            runtime.check_config=lambda:None;runtime.docker=lambda argv:argv
            runtime.query=lambda sql:json.dumps({'metadata':'expected'})
            def verify():runtime.command_number+=1;return {'Id':runtime.container}
            runtime.verify=verify;receipt,output=receipt_output(self.wanted)
            def execute(actual):
                argv,_,_=actual.admit();self.assertEqual(argv[argv.index('-U')+1],'postgres')
                self.assertEqual(runtime.command_number,2)
                actual.receipt.update(receipt);session._save(actual.folder,'receipt.json',receipt);return output
            unchanged={'rows':{},'catalog':{}};snapshots=iter([unchanged,unchanged]);saved={}
            capture=SimpleNamespace(snapshot=lambda query:next(snapshots),parse=json.loads)
            owned=SimpleNamespace(save=lambda folder,name,value:saved.update({name:value}))
            package=dict(snapshot_sql='select metadata',expected={'metadata':'expected'})
            with patch.object(session._Session,'execute',execute):
                result=r.diagnostic(runtime,package,self.stages,self.wanted,session,owned,capture)
            self.assertEqual(result['outcomes'],1727)
            self.assertTrue((runtime.folder/'0001-phased-session/receipt.json').is_file())
            self.assertFalse((runtime.folder/'0002-phased-session').exists())
            self.assertTrue(runtime.final_proof)

    def test_permanent_drift_refuses_after_valid_phases(self):
        with tempfile.TemporaryDirectory()as tmp:
            rt=FakeRuntime();rt.folder=Path(tmp);rt.command_number=0;rt.query=lambda sql:'{}'
            receipt,output=receipt_output(self.wanted)
            def run(runtime,phases):
                self.assertEqual([s for _,s in phases],list(self.stages.values()))
                path=runtime.folder/'0001-phased-session';path.mkdir();(path/'receipt.json').write_text(json.dumps(receipt));return output
            snapshots=iter([{'rows':[]},{'rows':[1]}]);capture=SimpleNamespace(snapshot=lambda query:next(snapshots),parse=json.loads)
            with self.assertRaises(AssertionError):r.diagnostic(rt,dict(snapshot_sql='metadata',expected={}),self.stages,self.wanted,SimpleNamespace(run=run,MARKER=session.MARKER),SimpleNamespace(save=lambda *a:None),capture)

    def test_saved_full_keysets_and_source_collision_fail_closed(self):
        with tempfile.TemporaryDirectory()as tmp:
            root=Path(tmp)/'source';root.mkdir();folder=Path(tmp)/'evidence';saved=folder/'executed-inputs';saved.mkdir(parents=True)
            (root/'a.py').write_text('one');(saved/'a.py').write_text('one');expected={'a.py':r.sha(b'one')}
            r.verify_saved(folder,expected,root,expected)
            for changed in ({},dict(expected,extra='0'*64),{'a.py':'0'*64}):
                with self.assertRaises(AssertionError):r.verify_saved(folder,expected,root,changed)
            (saved/'extra.py').write_text('extra')
            with self.assertRaises(AssertionError):r.verify_saved(folder,expected,root,expected)
            with self.assertRaises(AssertionError):r.merge_inputs(expected,{'a.py':'0'*64})
            with self.assertRaises(AssertionError):r.merge_inputs({'../a.py':'0'*64})
            with self.assertRaisesRegex(AssertionError,'deadline'):r.regular_sources(expected,root,time.monotonic()-1)

    def test_actual_retained_constructor_does_not_clobber_new_deadline_state(self):
        # One mocked Docker context observation; no child, daemon or DB starts.
        import importlib
        import os
        import shutil
        with patch.object(sys,'path',[str(CANDIDATE)]+sys.path):
            retained=importlib.import_module('record_review_v3_gate_b_runtime')
        with tempfile.TemporaryDirectory()as tmp:
            folder=Path(tmp);outer=time.monotonic()+600
            context=subprocess.CompletedProcess(['docker','context','inspect'],0,
                json.dumps([{'Endpoints':{'docker':{'Host':'unix:///inert.sock'}}}]),'')
            with patch.dict(os.environ,{},clear=True),patch.object(subprocess,'run',return_value=context)as call:
                runtime=r.runtime_type(retained)(folder,{},outer)
                self.assertEqual(call.call_count,1)
            try:
                self.assertFalse(runtime.cleanup_mode) # Frozen ancestor's field.
                self.assertIsNone(runtime.record_cleanup_kind)
                self.assertEqual(runtime.original_outer_deadline,outer)
                self.assertEqual(runtime.deadline,outer-60)
                self.assertLessEqual(runtime.remaining(600),120)
                self.assertFalse(runtime.started)
                self.assertFalse(runtime.network.create_attempted)
            finally:
                runtime.log.close()
                # This test owns this fresh empty local work directory; no DB
                # cleanup or global inventory is invoked by this harness.
                self.assertFalse(any(runtime.work.iterdir()))
                runtime.work.rmdir()

    def test_integration_gate_rejects_unrelated_changed_missing_and_symlink_sources(self):
        with tempfile.TemporaryDirectory()as tmp:
            root=Path(tmp);source=root/'tests/controlled-drugs/engine/candidate';source.mkdir(parents=True)
            baseline={f'old/{i}.py':r.sha(str(i).encode())for i in range(634)}
            for name in baseline:
                path=root/name;path.parent.mkdir(exist_ok=True);path.write_text(Path(name).stem)
            base=root/'baseline.json';base.write_text(json.dumps(baseline))
            current=dict(baseline)
            for name in r.LOCAL_FILES:
                (source/name).write_text('test');current[str((source/name).relative_to(root))]=r.sha(b'test')
            tests=root/'supabase/tests';tests.mkdir(parents=True)
            for name in r.TEST_FILES:
                (tests/name).write_text('test');current[str((tests/name).relative_to(root))]=r.sha(b'test')
            original_regular=r.regular_sources
            with patch.object(r,'canonical_location'),patch.object(r,'ROOT',root),patch.object(r,'SOURCE',source),patch.object(r,'BASELINE',base),patch.object(r,'BASELINE_SHA',r.sha(base.read_bytes())),patch.object(r,'regular_sources',side_effect=lambda inputs,deadline=None: original_regular(inputs,root,deadline)):
                fake=SimpleNamespace(source_inputs=lambda:dict(current))
                self.assertEqual(r.integration_gate(fake),current)
                for mutation in ('extra','oldhash','missing'):
                    bad=dict(current)
                    if mutation=='extra':bad['extra.py']='0'*64
                    if mutation=='oldhash':bad['old/0.py']='0'*64
                    if mutation=='missing':bad.pop(next(iter(bad)))
                    with self.subTest(mutation=mutation),self.assertRaises(AssertionError):r.integration_gate(SimpleNamespace(source_inputs=lambda:bad))
                selected=source/r.LOCAL_FILES[0];selected.unlink();selected.symlink_to(source/r.LOCAL_FILES[1])
                with self.assertRaises(AssertionError):r.integration_gate(fake)

    def test_slow_initial_admission_refuses_before_runtime_or_evidence_allocation(self):
        clock=[0.0]
        def build():clock[0]=121.0;return {}
        with patch.object(r.time,'monotonic',side_effect=lambda:clock[0]),patch.object(r,'runtime_type')as constructor,patch.object(r.tempfile,'mkdtemp')as allocate,patch.object(r,'load_fixture')as fixtures:
            with self.assertRaisesRegex(AssertionError,'deadline'):r.prepare_reference(SimpleNamespace(),SimpleNamespace(build=build),120.0)
            constructor.assert_not_called();allocate.assert_not_called();fixtures.assert_not_called()
        source=(CANDIDATE/'record_review_v3_configuration_record_runtime.py').read_text()
        self.assertIn('admission_deadline=min(start+120,cutoff)',source)
        self.assertLess(source.index('prepare_reference(owned,assembly,admission_deadline)'),source.index('Runtime=runtime_type(retained)'))

    def test_integration_gate_brackets_frozen_source_inventory_deadline(self):
        clock=[0.0]
        def observed():clock[0]=121.0;return {}
        with patch.object(r,'canonical_location'),patch.object(r.time,'monotonic',side_effect=lambda:clock[0]),patch.object(r,'regular_sources')as scan:
            with self.assertRaisesRegex(AssertionError,'deadline'):r.integration_gate(SimpleNamespace(source_inputs=observed),120.0)
            scan.assert_not_called()


    def test_pure_source_package_exact_hashes_and_forged_metadata_refusal(self):
        import importlib
        with patch.object(sys,'path',[str(CANDIDATE)]+sys.path):
            assembly=importlib.import_module('record_review_v3_configuration_record_profile')
        with patch.object(subprocess,'run',side_effect=AssertionError('process forbidden')),patch.object(subprocess,'Popen',side_effect=AssertionError('process forbidden')),patch.object(socket,'socket',side_effect=AssertionError('network forbidden')):
            package=assembly.build()
        r.admit_package(package)
        self.assertEqual(len(package['input_source_hashes']),267)
        for mutation in ('metadata','install','inputcount','acceptance','admitted'):
            bad=deepcopy(package)
            if mutation=='metadata':bad['expected']['kind']='forged'
            if mutation=='install':bad['install']+='--changed'
            if mutation=='inputcount':bad['input_source_hashes'].pop(next(iter(bad['input_source_hashes'])))
            if mutation=='acceptance':bad['acceptance']=0
            if mutation=='admitted':bad['admitted_artifact']=0
            with self.subTest(mutation=mutation),self.assertRaises(AssertionError):r.admit_package(bad)
        self.assertEqual(r.REFERENCE_SECONDS,600);self.assertEqual(r.FINAL_SECONDS,60)
        self.assertEqual(r.EMERGENCY_SECONDS,180);self.assertEqual(r.STREAM_LIMIT,128*1024**2)


    def exercise_actual_terminal_entrypoint(self,folder,mode,*,module=r,primary=False):
        # Calls the ACTUAL orchestration entry point. Only sources/resources and
        # elapsed time are inert callbacks; no process/DB/network can start.
        clock=[100.0];events=[];saves=[];instances=[]
        package={'preflight_sql':'test-only preflight'}
        (folder/'source-hashes.json').write_text('{}')
        modules={}
        for name in ('record_review_v3_gate_b_runtime','record_review_v3_gate_a_runtime',
                     'record_review_v3_gate_b_snapshot','record_review_v3_configuration_record_profile',
                     'canonical_review_prefix'):
            item=ModuleType(name);item.__file__=str(module.SOURCE/(name+'.py'));modules[name]=item
        retained=modules['record_review_v3_gate_b_runtime'];owned=modules['record_review_v3_gate_a_runtime']
        capture=modules['record_review_v3_gate_b_snapshot'];assembly=modules['record_review_v3_configuration_record_profile']
        phased=SimpleNamespace(__file__=str(module.SOURCE/module.LOCAL_FILES[1]))
        frozen={str(Path(item.__file__).relative_to(module.ROOT)):'0'*64 for item in (retained,owned,capture,assembly,phased)}
        result_writes=[0]
        def save(path,name,value):
            if name=='result':result_writes[0]+=1
            if mode=='corrective_error' and name=='result' and result_writes[0]==2:
                raise OSError('synthetic corrective result write failure')
            if mode=='primary_write_error' and name=='result':
                raise OSError('synthetic final result write failure')
            (path/(name+'.json')).write_text(json.dumps(value))
            saves.append((name,deepcopy(value)))
            if name=='result' and result_writes[0]==1:
                clock[0]=701.0 if mode in ('late','corrective_error','move_error') else 699.25
                if mode=='initial_write_error':raise OSError('synthetic error after complete result write')
        owned.save=save
        retained.install_proof=lambda *args:events.append('install')
        capture.snapshot=lambda query:{};capture.baseline=lambda *args:None
        modules['canonical_review_prefix'].admit_canonical206=lambda *args:{'prefix205':[],'binding206':{'filename':'test-only.sql'}}
        class InertRuntime:
            def __init__(self,path,pkg,outer):
                self.folder=path;self.original_outer_deadline=outer;self.cleanup_deadline=None
                self.record={'removed':False};self.record_cleanup_kind=None;instances.append(self)
            def start(self,files):events.append('start')
            def query(self,sql):return ''
            def cleanup(self,normal=False):
                events.append(('cleanup',normal));self.record['removed']=True
                self.record_cleanup_kind='normal_outer_deadline'if normal else 'single_emergency_reserve'
                self.cleanup_deadline=700.0 if normal else 800.0
                clock[0]=699.0
        def diagnostic(*args):
            if primary:raise ValueError('synthetic primary diagnostic failure')
            return {'passed':True}
        outcome=None;failure=None
        with ExitStack()as stack:
            stack.enter_context(patch.dict(sys.modules,modules))
            stack.enter_context(patch.object(module,'canonical_location'))
            stack.enter_context(patch.object(module.time,'monotonic',side_effect=lambda:clock[0]))
            stack.enter_context(patch.object(module,'load_session',return_value=phased))
            stack.enter_context(patch.object(module,'prepare_reference',return_value=(folder,package,{}, {}, {}, {}, frozen)))
            stack.enter_context(patch.object(module,'runtime_type',return_value=InertRuntime))
            stack.enter_context(patch.object(module,'source_inputs',return_value=frozen))
            stack.enter_context(patch.object(module,'verify_saved'))
            stack.enter_context(patch.object(module,'diagnostic',side_effect=diagnostic))
            stack.enter_context(patch.object(subprocess,'run',side_effect=AssertionError('process forbidden')))
            stack.enter_context(patch.object(subprocess,'Popen',side_effect=AssertionError('process forbidden')))
            stack.enter_context(patch.object(socket,'socket',side_effect=AssertionError('network forbidden')))
            if mode=='move_error':stack.enter_context(patch.object(Path,'rename',side_effect=OSError('synthetic revocation failure')))
            try:outcome=module.execute_integrated()
            except BaseException as exc:failure=exc
        self.assertEqual(len(instances),1)
        self.assertEqual(sum(isinstance(e,tuple)and e[0]=='cleanup'for e in events),1)
        self.assertEqual(instances[0].original_outer_deadline,700.0)
        return dict(outcome=outcome,failure=failure,clock=clock[0],events=events,saves=saves,runtime=instances[0])

    def test_actual_entrypoint_final_result_write_overrun_refuses_and_revokes_late_pass(self):
        with tempfile.TemporaryDirectory()as tmp:
            folder=Path(tmp);value=self.exercise_actual_terminal_entrypoint(folder,'late')
            self.assertIsNone(value['outcome'])
            self.assertIsInstance(value['failure'],r.TerminalResultFailure)
            self.assertEqual(str(value['failure']),'final_result_write_deadline')
            result=json.loads((folder/'result.json').read_text());terminal=json.loads((folder/'terminal-failure.json').read_text())
            self.assertIs(result['passed'],False);self.assertIs(terminal['passed'],False)
            self.assertEqual(result['elapsed_seconds'],601.0)
            self.assertEqual(terminal['observed_after_result_write'],701.0)
            self.assertEqual(terminal['original_outer_deadline'],700.0)
            self.assertTrue(terminal['result_authority_revoked'])
            attempted=json.loads((folder/terminal['attempted_result']).read_text())
            self.assertIs(attempted['passed'],True)
            self.assertNotEqual(folder/terminal['attempted_result'],folder/'result.json')
            self.assertEqual(value['runtime'].cleanup_deadline,700.0)

    def test_actual_entrypoint_timely_result_write_returns_within_original_deadline(self):
        with tempfile.TemporaryDirectory()as tmp:
            folder=Path(tmp);value=self.exercise_actual_terminal_entrypoint(folder,'timely')
            self.assertIsNone(value['failure']);self.assertEqual(value['outcome'],folder/'result.json')
            self.assertLess(value['clock'],700.0);self.assertIs(json.loads((folder/'result.json').read_text())['passed'],True)
            self.assertFalse((folder/'terminal-failure.json').exists())
            self.assertFalse(list(folder.glob('non-authoritative-result-*')))

    def test_actual_entrypoint_corrective_write_error_cannot_restore_authoritative_pass(self):
        with tempfile.TemporaryDirectory()as tmp:
            folder=Path(tmp);value=self.exercise_actual_terminal_entrypoint(folder,'corrective_error')
            self.assertIsInstance(value['failure'],r.TerminalResultFailure)
            self.assertIsInstance(value['failure'].__cause__,OSError)
            self.assertIsNone(value['outcome']);self.assertFalse((folder/'result.json').exists())
            terminal=json.loads((folder/'terminal-failure.json').read_text())
            self.assertIs(terminal['passed'],False);self.assertTrue(terminal['result_authority_revoked'])
            self.assertTrue((folder/terminal['attempted_result']).is_file())

    def test_actual_entrypoint_initial_write_then_raise_revokes_written_success(self):
        with tempfile.TemporaryDirectory()as tmp:
            folder=Path(tmp);value=self.exercise_actual_terminal_entrypoint(folder,'initial_write_error')
            self.assertIsInstance(value['failure'],r.TerminalResultFailure)
            self.assertEqual(str(value['failure']),'final_result_write_error')
            self.assertIsInstance(value['failure'].__cause__,OSError)
            self.assertIsNone(value['outcome']);self.assertIs(json.loads((folder/'result.json').read_text())['passed'],False)
            terminal=json.loads((folder/'terminal-failure.json').read_text())
            self.assertEqual(terminal['write_error_type'],'OSError')
            self.assertTrue(terminal['result_authority_revoked'])
            self.assertIs(json.loads((folder/terminal['attempted_result']).read_text())['passed'],True)

    def test_actual_entrypoint_revocation_failure_is_explicit_and_never_returns(self):
        with tempfile.TemporaryDirectory()as tmp:
            folder=Path(tmp);value=self.exercise_actual_terminal_entrypoint(folder,'move_error')
            self.assertIsInstance(value['failure'],r.TerminalResultFailure);self.assertIsNone(value['outcome'])
            terminal=json.loads((folder/'terminal-failure.json').read_text())
            self.assertIs(terminal['passed'],False);self.assertFalse(terminal['result_authority_revoked'])
            self.assertEqual(terminal['revocation_error_type'],'OSError')
            # I/O refusal prevents revocation, so this separately retained terminal
            # failure defeats the attempted result; no caller may treat it as PASS.
            self.assertEqual(terminal['code'],'final_result_write_deadline')

    def test_actual_entrypoint_result_error_preserves_existing_primary_exception(self):
        with tempfile.TemporaryDirectory()as tmp:
            folder=Path(tmp);value=self.exercise_actual_terminal_entrypoint(folder,'primary_write_error',primary=True)
            self.assertIsInstance(value['failure'],ValueError)
            self.assertEqual(str(value['failure']),'synthetic primary diagnostic failure')
            self.assertIsNone(value['outcome'])
            terminal=json.loads((folder/'terminal-failure.json').read_text())
            self.assertEqual(terminal['code'],'final_result_write_error')
            self.assertFalse((folder/'result.json').exists())


    def test_completion_never_accepts_late_cleanup_or_partial_result(self):
        self.assertTrue(r.completion(True,None,True,599,600))
        for args in [(False,None,True,1,600),(True,{},True,1,600),(True,None,False,1,600),(True,None,1,1,600),(True,None,True,600,600),(True,None,True,float('nan'),600)]:self.assertFalse(r.completion(*args))


if __name__=='__main__':unittest.main(verbosity=2)
