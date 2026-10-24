"""Offline regressions for full preservation and source-only reference boundaries."""
import copy
import gzip
import json
from pathlib import Path
import sys
import unittest
import tempfile
import subprocess
from types import SimpleNamespace
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'tests/controlled-drugs/engine/candidate'
sys.path.insert(0,str(SOURCE))
import record_review_v3_gate_a_snapshot as capture
import record_review_v3_gate_a_runtime as runtime


def fixtures():
    before={key:{} for key in capture.KEYS}
    before.update(catalog={'schemas':{'public':{'owner':1}},'functions':{'public.old()':{'body':'old'}},
                          'relations':{'public.controlled_stock_events':{'triggers':[{'attributes':{'oid':'old','tgisinternal':True,'tgenabled':'O'}}]}}},
                  rows={'public.events':[{'id':1,'receipt':{'x':'original'}}]},types={'public.old':{'oid':1}},ledger=[{'version':'original'}])
    after=copy.deepcopy(before)
    after['catalog']['schemas']['controlled_review_v3']={}
    for name in capture.declaration.FACADES:after['catalog']['functions']['public.'+name+'(jsonb)']={}
    for index in range(8):after['catalog']['functions']['controlled_review_v3.private'+str(index)+'()']={}
    for index in range(48):after['catalog']['relations']['controlled_review_v3.r'+str(index)]={'triggers':[]}
    for name in capture.declaration.TABLES:after['rows']['controlled_review_v3.'+name]=[]
    for index in range(26):after['types']['controlled_review_v3.t'+str(index)]={}
    for oid in ('new1','new2'):
        after['catalog']['relations']['public.controlled_stock_events']['triggers'].append({'attributes':{'oid':oid,'tgisinternal':True,'tgenabled':'O'}})
    return before,after


class Preservation(unittest.TestCase):
    def test_only_exact_new_namespace_and_two_parent_ri_are_allowed(self):
        before,after=fixtures();capture.preserved(before,after,['new1','new2'])

    def test_old_receipt_column_acl_trigger_type_and_ledger_changes_reject(self):
        edits=[lambda x:x['rows']['public.events'][0]['receipt'].update(x='rewritten'),
               lambda x:x['catalog']['relations']['public.controlled_stock_events'].update(column_acl='grant'),
               lambda x:x['catalog']['relations']['public.controlled_stock_events']['triggers'][0]['attributes'].update(tgenabled='D'),
               lambda x:x['types']['public.old'].update(oid=2),lambda x:x['ledger'].append({'version':'extra'})]
        for edit in edits:
            with self.subTest(edit=edit):
                before,after=fixtures();edit(after)
                with self.assertRaises(AssertionError):capture.preserved(before,after,['new1','new2'])

    def test_extra_rows_or_missing_original_relation_reject(self):
        for kind in ('extra','missing'):
            before,after=fixtures()
            if kind=='extra':after['rows']['public.unexpected']=[]
            else:del after['rows']['public.events']
            with self.assertRaises(AssertionError):capture.preserved(before,after,['new1','new2'])

    def test_disabled_or_unenumerated_new_parent_ri_reject(self):
        before,after=fixtures();after['catalog']['relations']['public.controlled_stock_events']['triggers'][-1]['attributes']['tgenabled']='D'
        with self.assertRaises(AssertionError):capture.preserved(before,after,['new1','new2'])
        before,after=fixtures()
        with self.assertRaises(AssertionError):capture.preserved(before,after,['new1','unknown'])

    def test_unexpected_public_facade_overload_rejects(self):
        before,after=fixtures();after['catalog']['functions']['public.extra(text)']={}
        with self.assertRaises(AssertionError):capture.preserved(before,after,['new1','new2'])

    def test_prelock_check_preserves_entire_value_after_barrier(self):
        before,_=fixtures()
        package={'markers':{'admission':'-- ADMISSION --'},'install':'begin;\nselect pg_advisory_xact_lock(90271040,0);\n-- ADMISSION --\ncreate schema controlled_review_v3;\ncommit;\n'}
        sql=runtime.installer(package,before)
        self.assertLess(sql.index('pg_advisory_xact_lock'),sql.index('V3 original pre-lock snapshot changed'))
        self.assertLess(sql.index('V3 original pre-lock snapshot changed'),sql.index('create schema controlled_review_v3'))
        self.assertIn(capture.literal(before),sql)
        self.assertIn('private206_literal',capture.VALUE)
        self.assertIn('types',capture.VALUE)
        self.assertNotIn('create function',capture.VALUE)

    def test_snapshot_scope_is_superset_without_changing_retained_contract(self):
        self.assertIn('controlled_review_v3',capture.SQL)
        self.assertNotIn('controlled_review_v3',capture.retained.SNAPSHOT_SQL)
        self.assertIn('t.tgrelid=c.oid',capture.SQL)
        self.assertIn('to_jsonb(a)',capture.SQL)
        self.assertIn('to_jsonb(n)',capture.SQL)

    def test_observer_parser_refuses_ambiguous_or_duplicate_output(self):
        for raw in ('{"x":1}\n{"x":2}','{"x":1,"x":2}','{"x":{"a":1,"a":2}}','true','NOTICE extra\n{}'):
            with self.subTest(raw=raw),self.assertRaises((AssertionError,json.JSONDecodeError)):capture.parse(raw)
        self.assertEqual(capture.parse('[{"pid":1}]\n'),[{'pid':1}])

    def test_modes_have_no_protocol_acceptance_and_measurement_requires_admission(self):
        text=Path(runtime.__file__).read_text()
        self.assertIn("add_argument('--measurement'",text)
        self.assertNotIn("add_argument('--acceptance'",text)
        self.assertIn('acceptance=False',text)
        self.assertIn('from record_review_v3_gate_a_admission import admit',text)
        self.assertIn('reference_handshake(args.reference_evidence',text)
        self.assertEqual(runtime.MEASUREMENT_SECONDS,1200)
        self.assertEqual(runtime.REFERENCE_SECONDS,600)
        self.assertEqual(runtime.CLEANUP_SECONDS,180)

    def test_actual_wait_binding_requires_pid_start_key_blocker_and_wait(self):
        identity={'pid':42,'backend_start':'fixed-start'};holder={'pid':17,'backend_start':'holder-start'}
        observed={'pid':42,'backend_start':'fixed-start','classid':'90271040','objid':'0','objsubid':2,'query_start':'actual-query','waitstart':'actual-wait','blockers':[17],'granted':False,'mode':'ExclusiveLock'}
        self.assertEqual(runtime.observed_wait_matches(identity,holder,[observed]),observed)
        for key,value in [('pid',43),('backend_start','new-start'),('classid','90271041'),('objid','1'),('objsubid',1),('waitstart',None),('query_start',None),('blockers',[]),('granted',True),('mode','ShareLock')]:
            wrong=dict(observed);wrong[key]=value
            with self.subTest(key=key),self.assertRaises(AssertionError):runtime.observed_wait_matches(identity,holder,[wrong])
        with self.assertRaises(AssertionError):runtime.observed_wait_matches(identity,holder,[observed,observed])

    def test_measurement_snapshot_compression_preserves_exact_bytes_and_keyset(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);value={key:{} for key in capture.KEYS}
            runtime.COMPRESSED_MEASUREMENTS[str(folder)]=runtime.evidence_io.Evidence(folder)
            try:
                runtime.save(folder,'snapshot',value);runtime.verify_compressed(folder)
                raw=(json.dumps(value,sort_keys=True,indent=2)+'\n').encode()
                stored=folder/'snapshot.json.gz'
                self.assertEqual(gzip.decompress(stored.read_bytes()),raw)
                self.assertFalse((folder/'snapshot.json').exists())
                original=stored.read_bytes();stored.write_bytes(original[:-5])
                with self.assertRaises((AssertionError,EOFError)):runtime.verify_compressed(folder)
                stored.write_bytes(original)
                (folder/'extra.json.gz').write_bytes(original)
                with self.assertRaises(AssertionError):runtime.verify_compressed(folder)
                (folder/'extra.json.gz').unlink();runtime.verify_compressed(folder)
                with self.assertRaises(AssertionError):runtime.save(folder,'snapshot',value)
            finally:runtime.COMPRESSED_MEASUREMENTS.pop(str(folder))
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);runtime.save(folder,'reference',value)
            self.assertTrue((folder/'reference.json').is_file())
            self.assertFalse(list(folder.glob('*.gz')))

    def test_session_close_preserves_partial_identity_and_stderr(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);codec=runtime.evidence_io.Evidence(folder)
            runtime.COMPRESSED_MEASUREMENTS[str(folder)]=codec
            owner=SimpleNamespace(folder=folder,work=folder,container='fixture-only',verify=lambda:None,remaining=lambda n:n,
                docker=lambda argv:[sys.executable,'-c',"import sys,time;print('{\"pid\":42,\"backend_start\":\"fixed\"}',flush=True);sys.stderr.write('partial stream');sys.stderr.flush();time.sleep(30)"])
            try:
                session=runtime.Session(owner,'fixture','exact stdin')
                self.assertEqual(session.identity(),{'pid':42,'backend_start':'fixed'})
                session.close();codec.verify()
                self.assertEqual(runtime.evidence_io.read_member(folder,'fixture-executed.sql'),b'exact stdin')
                self.assertEqual(runtime.evidence_io.read_member(folder,'fixture-stderr.log'),b'partial stream')
                self.assertFalse(list(folder.glob('pending-*')))
            finally:runtime.COMPRESSED_MEASUREMENTS.pop(str(folder))

    def test_session_output_limit_is_retained_and_cannot_complete(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);codec=runtime.evidence_io.Evidence(folder)
            runtime.COMPRESSED_MEASUREMENTS[str(folder)]=codec
            owner=SimpleNamespace(folder=folder,work=folder,container='fixture-only',verify=lambda:None,remaining=lambda n:n,
                docker=lambda argv:[sys.executable,'-c',"import os,signal;signal.signal(signal.SIGXFSZ,signal.SIG_DFL);os.write(1,b'x'*8192);os.write(1,b'y'*8192)"])
            try:
                with patch.object(runtime.evidence_io,'MAX_MEMBER_BYTES',4096):
                    session=runtime.Session(owner,'overflow-session','exact stdin')
                    with self.assertRaisesRegex(AssertionError,'output'):session.finish()
                    self.assertEqual(runtime.evidence_io.read_member(folder,'overflow-session-stdout.log'),b'x'*4096)
                    codec.verify();self.assertFalse(list(folder.glob('pending-*')))
            finally:runtime.COMPRESSED_MEASUREMENTS.pop(str(folder))

    def test_completion_rejects_missing_duplicate_or_false_matrix_evidence(self):
        import record_review_v3_gate_a_restore as restore
        package={'markers':runtime.declaration.MARKERS,'install':'\n'.join(runtime.declaration.MARKERS.values()),
                 'preflight_sql':'select 1;','expected_ledger206':[{'version':'205'},{'version':'206'}]}
        def recorded(owner,label,script,message,code='23514',user='postgres'):
            return dict(case=label,sqlstate=code,message=message,full_snapshot_rollback=True)
        with tempfile.TemporaryDirectory() as temporary,patch.object(runtime,'failure',side_effect=recorded),patch.object(capture,'under_barrier_check',return_value=''):
            owner=SimpleNamespace(folder=Path(temporary))
            proof={'admission':runtime.admission_negatives(owner,package,{}),'metadata':runtime.metadata_negatives(owner,package),
                   'access':runtime.access_and_stubs(owner),'old_population':dict(case='old-private-population',full_snapshot_rollback=True),
                   'barrier':dict(actual_pid_start_query_start_key_blocker_bound=True,shared_holder=True,prelock_full_snapshot_recheck_refused=True,exact_committed_fixture_delta=True,full_original_restored=True,sqlstate='23514'),
                   'clean_wait':dict(shared_holder=True,actual_pid_start_query_start_key_blocker_bound=True,full_old_snapshot_visible=True,installed_after_release=True),
                   'seed':dict(genuine_canonical_writer_history=True),'final_seals':True,'final_full_snapshot_unchanged':True,
                   'restore':dict(passed=True,source_full_snapshot_unchanged=True,refusal_case_names=list(restore.RESTORE_REFUSAL_CASES),
                     refusal_cases=[dict(case=n,rollback_exact=True,**({'sqlstate':'3F000'if i==0 else'23514'}if i<7 else{'comparison_refused':True}))for i,n in enumerate(restore.RESTORE_REFUSAL_CASES)])}
            runtime.complete_measurement(proof,package)
            for family in ('admission','metadata','access'):
                for change in ('missing','duplicate','false'):
                    wrong=copy.deepcopy(proof)
                    if change=='missing':wrong[family].pop()
                    elif change=='duplicate':wrong[family][-1]=wrong[family][0]
                    else:wrong[family][0]['full_snapshot_rollback']=False
                    with self.subTest(family=family,change=change),self.assertRaises(AssertionError):runtime.complete_measurement(wrong,package)
            for key in ('clean_wait','restore','seed'):
                wrong=copy.deepcopy(proof)
                if key=='clean_wait':wrong[key]['installed_after_release']=False
                elif key=='restore':wrong[key]['refusal_cases'].pop()
                else:wrong[key]['genuine_canonical_writer_history']=False
                with self.subTest(key=key),self.assertRaises(AssertionError):runtime.complete_measurement(wrong,package)

    def test_primary_refusal_rejects_context_echo_and_multiple_errors(self):
        def result(text):return subprocess.CompletedProcess([],1,'',text)
        self.assertEqual(capture.primary_failure(result('ERROR:  23514: intended fault\nCONTEXT: function\n'),'23514','intended fault'),'intended fault')
        for text in ('ERROR:  23514: different fault\nCONTEXT: intended fault\n',
                     'ERROR:  42501: intended fault\n',
                     'CONTEXT: ERROR:  23514: intended fault\n',
                     "STATEMENT: select 'ERROR: 23514: intended fault';\n",
                     'ERROR:  23514: intended fault\nERROR:  23514: intended fault\n'):
            with self.subTest(text=text),self.assertRaises(AssertionError):capture.primary_failure(result(text),'23514','intended fault')

    def test_reference_transition_rejects_omitted_added_or_changed_keys(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);inputs=folder/'executed-inputs';inputs.mkdir()
            (inputs/'fixed.py').write_text('fixed');old={'fixed.py':runtime.sha(b'fixed')}
            expected={'independent':'definition'}
            (folder/'source-hashes.json').write_text(json.dumps(old))
            (folder/'result.json').write_text(json.dumps({'kind':'record-review-v3-gate-a-reference-v1','passed':True,'acceptance':False,'all_owned_cleanup_verified':True}))
            for name in ('independent-expected','observed'):(folder/(name+'.json')).write_text(json.dumps(expected))
            current={**old,'new.py':'new-reviewed-sha'}
            admitted={'expected':expected,'wrapper_sha256':'fixed-wrapper-sha','derivation_input_sha256':old,'reference_provenance':{'result_sha256':runtime.sha((folder/'result.json').read_bytes()),'source_map_sha256':runtime.sha((folder/'source-hashes.json').read_bytes()),'source_input_count':1}}
            review={'kind':'record-review-v3-gate-a-source-transition-review-v1','approved':True,'reference_source_hashes':old,'measurement_source_hashes':current,'wrapper_sha256':'fixed-wrapper-sha'}
            transition=folder/'review.json';transition.write_text(json.dumps(review))
            self.assertTrue(runtime.reference_handshake(folder,transition,current,admitted)['full_inventory_transition_verified'])
            for wrong in (old,{**current,'extra.py':'unreviewed'},{**current,'fixed.py':'changed'}):
                with self.assertRaises(AssertionError):runtime.reference_handshake(folder,transition,wrong,admitted)
            (inputs/'unexpected.py').write_text('extra')
            with self.assertRaises(AssertionError):runtime.reference_handshake(folder,transition,current,admitted)

    def test_saved_inventory_rejects_an_extra_executed_input(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);(folder/'executed-inputs').mkdir()
            (folder/'executed-inputs'/'a.py').write_text('original')
            values={'a.py':runtime.sha(b'original')}
            with patch.object(runtime,'source_inputs',return_value=values):
                runtime.verify_frozen(folder,values)
                (folder/'executed-inputs'/'unexpected.py').write_text('extra')
                with self.assertRaises(AssertionError):runtime.verify_frozen(folder,values)

    def test_config_tamper_is_refused_before_cli_start(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary);project=folder/'project';(project/'supabase').mkdir(parents=True)
            expected=runtime.expected_config('owned-fixture')
            (project/'supabase/config.toml').write_bytes(expected.replace(b'64661',b'64671'))
            (folder/'generated-supabase-config.toml').write_bytes(expected)
            owner=object.__new__(runtime.Runtime)
            owner.started=True;owner.project=project;owner.folder=folder;owner.config=expected
            with patch.object(runtime.subprocess,'run') as execute:
                with self.assertRaises(AssertionError):owner.command(['supabase','start'])
                execute.assert_not_called()
            (project/'supabase/config.toml').write_bytes(expected)
            (folder/'generated-supabase-config.toml').write_bytes(expected+b'#changed')
            with self.assertRaises(AssertionError):owner.check_config()

    def test_zero_service_failed_bootstrap_removes_only_owned_work(self):
        with tempfile.TemporaryDirectory() as temporary:
            folder=Path(temporary)/'evidence';folder.mkdir()
            work=Path(temporary)/'owned';project=work/'project';(project/'supabase').mkdir(parents=True)
            expected=runtime.expected_config('owned-fixture')
            (project/'supabase/config.toml').write_bytes(expected)
            (folder/'generated-supabase-config.toml').write_bytes(expected)
            owner=object.__new__(runtime.Runtime)
            owner.started=True;owner.identity='owned-fixture';owner.project=project;owner.work=work
            owner.folder=folder;owner.config=expected;owner.cleanup_deadline=None;owner.owned_services={}
            owner.record={'removed':False};owner.log=(folder/'runner.log').open('w')
            with patch.object(owner,'service_inventory',return_value={}),patch.object(owner,'command',return_value=subprocess.CompletedProcess([],0,'','')) as command:
                owner.cleanup()
                self.assertEqual(command.call_args.args[0],['docker','volume','ls','-q','--filter','label=com.supabase.cli.project=owned-fixture'])
            self.assertFalse(work.exists());self.assertTrue(folder.exists())
            self.assertTrue(owner.record['removed'])
            self.assertTrue(json.loads((folder/'cleanup.json').read_text())['zero_service_bootstrap'])

    def test_base_deadline_reset_cannot_extend_single_cleanup_reserve(self):
        owner=object.__new__(runtime.Runtime)
        owner.deadline=1000;owner.cleanup_deadline=280
        with patch.object(runtime.time,'monotonic',return_value=200):
            self.assertEqual(owner.remaining(180),80)
            owner.deadline=380 # Retained base cleanup resets this; immutable cap wins.
            self.assertEqual(owner.remaining(180),80)
        with patch.object(runtime.time,'monotonic',return_value=281):
            with self.assertRaises(AssertionError):owner.remaining(1)

    def test_non_database_id_replacement_or_label_drift_rejects(self):
        captured={'db-id':{'name':'db','project':'owned','workdir':'/owned'},
                  'auth-id':{'name':'auth','project':'owned','workdir':'/owned'}}
        runtime.assert_owned_inventory(captured,copy.deepcopy(captured))
        replaced=copy.deepcopy(captured);replaced['replacement-auth-id']=replaced.pop('auth-id')
        with self.assertRaises(AssertionError):runtime.assert_owned_inventory(captured,replaced)
        changed=copy.deepcopy(captured);changed['auth-id']['workdir']='/other'
        with self.assertRaises(AssertionError):runtime.assert_owned_inventory(captured,changed)
        with self.assertRaises(AssertionError):runtime.assert_removed_ids(captured,['auth-id','unrelated-id'])
        with self.assertRaises(AssertionError):runtime.assert_removed_ids({},[])
        runtime.assert_removed_ids(captured,['unrelated-id'])

    def test_source_inventory_includes_runtime_and_all_derivation_inputs(self):
        values=runtime.source_inputs()
        for name in ('record_review_v3_gate_a_runtime.py','record_review_v3_gate_a_snapshot.py','record_review_v3_gate_a.py','record_review_v3_gate_a_descriptor.py','record-review-v3-gate-a.sql'):
            self.assertIn(str((SOURCE/name).relative_to(ROOT)),values)
        self.assertIn(str(Path(__file__).relative_to(ROOT)),values)
        self.assertIn('.github/workflows/ci.yml',values)
        self.assertIn('supabase/tests/owned_attachment_clone.py',values)
        self.assertEqual(len([p for p in values if p.startswith('supabase/migrations/')]),206)


if __name__=='__main__':unittest.main()
