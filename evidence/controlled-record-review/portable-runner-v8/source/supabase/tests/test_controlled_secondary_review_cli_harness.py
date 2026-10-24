"""Offline adversarial checks of the new206 observer/preservation boundary."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'tests/controlled-drugs/engine/candidate'
sys.path.insert(0,str(SOURCE))
import canonical_post206 as post
import secondary_review_cli_atomicity as atomic
from secondary_review_cli_body import check_cli_body
from canonical_review_prefix import admit_canonical206


class CanonicalReviewCliTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package=check_cli_body(SOURCE)
        cls.binding=admit_canonical206(SOURCE,sorted((ROOT/'supabase/migrations').glob('*.sql')))['binding206']
        cls.parent=json.loads((SOURCE/'release-expected-204.json').read_text())

    def test_complete_source_ledger_rejects_historical_statement_change(self):
        before=copy.deepcopy(self.package['expected_ledger'])
        actual=before+[dict(version=self.binding['version'],name=self.binding['name'],statements=self.binding['expected_statements'])]
        post.verify_ledger206(actual,before,self.binding)
        for index in (0,187,204,205):
            changed=copy.deepcopy(actual);changed[index]['statements'][0]+=' -- altered'
            with self.assertRaises(AssertionError):post.verify_ledger206(changed,before,self.binding)

    def test_reference_cannot_adopt_observed_ledger(self):
        value=dict(ledger=copy.deepcopy(self.package['expected_ledger']),parent=self.parent['expected_technical_manifest'],
                   writers=self.parent['canonical_writer_definition_hashes'],catalog={'schemas':{},'functions':{},'relations':{}},types={},
                   parent_literal_hash_valid=True,parent_literal=[dict(revision=1,definition=self.parent['expected_technical_manifest'],definition_hash='a'*64,recorded_at='synthetic')])
        post.verify_reference205(value,self.package,self.parent)
        value['ledger'][0]['name']+='changed'
        with self.assertRaises(AssertionError):post.verify_reference205(value,self.package,self.parent)

    def test_facade_identity_mapping_is_finite_and_source_derived(self):
        expected=self.package['expected']
        actual=post.facade_regprocedures(expected)
        self.assertEqual(set(actual),{name+'(jsonb)'for name in post.FACADE_NAMES})
        original='public.prepare_controlled_secondary_review(p_request jsonb)'
        for replacement in (None,'public.prepare_controlled_secondary_review(jsonb)',
                            'public.prepare_controlled_secondary_review(p_request text)',
                            'public.unexpected_controlled_secondary_review(p_request jsonb)'):
            bad=copy.deepcopy(expected)
            definition=bad['functions'].pop(original)
            if replacement:bad['functions'][replacement]=definition
            with self.assertRaises(AssertionError):post.facade_regprocedures(bad)
        bad=copy.deepcopy(expected);bad['functions']['public.extra(p_request jsonb)']={}
        with self.assertRaises(AssertionError):post.facade_regprocedures(bad)

    def test_error_in_echoed_sql_cannot_impersonate_primary_failure(self):
        def result(message):
            return subprocess.CompletedProcess([],1,'',json.dumps({'_tag':'Error','error':{'code':'MigrationApplyError','message':message}}))
        exact='ERROR: '+atomic.LEDGER_MESSAGE+' (SQLSTATE P0001)'
        atomic.failure(result(exact),'ledgerfault')
        for message in ('ERROR: permission denied (SQLSTATE 42501)\n'+exact,exact.replace('P0001','P0003')):
            with self.assertRaises(AssertionError):atomic.failure(result(message),'ledgerfault')

    def test_forged_or_incomplete_observer_fails(self):
        okay=subprocess.CompletedProcess([],0,'','')
        flags={name:True for name in atomic.old_atomic.OBSERVER_FLAGS}
        atomic.run_checked(lambda *_:dict(result=okay,barrier_observation=flags),'clean206','body')
        for name in flags:
            bad=dict(flags);bad[name]=False
            with self.assertRaises(AssertionError):atomic.run_checked(lambda *_:dict(result=okay,barrier_observation=bad),'clean206','body')

    def test_snapshot_retains_extension_raw_acl_and_internal_triggers(self):
        sql=post.SNAPSHOT_SQL
        self.assertIn("'controlled_review_cli_fixture'",sql)
        self.assertIn('to_jsonb(a)',sql)
        self.assertIn('to_jsonb(t)',sql)
        self.assertIn('from pg_trigger t where t.tgrelid=c.oid',sql)
        self.assertNotIn('not t.tgisinternal',sql)
        self.assertIn('to_jsonb(e)',sql)
        for fragment in ('pg_namespace','pg_proc','pg_class','pg_type'):
            self.assertIn(fragment,sql)

    def test_observer_json_accepts_arrays_and_rejects_ambiguous_output(self):
        spec=importlib.util.spec_from_file_location('review_cli_observer_test',SOURCE/'run-secondary-review-cli-atomicity.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        self.assertEqual(module.observer_json('[{"pid":352,"backend_start":"2026-10-22T00:00:00Z"}]\n'),
                         [{'pid':352,'backend_start':'2026-10-22T00:00:00Z'}])
        self.assertEqual(module.observer_json('  \n{"locks":[],"blockers":[1]}\n'),{'locks':[],'blockers':[1]})
        for invalid in ('[]\n{}','NOTICE: other output\n[]','{"pid":1,"pid":2}','[{"pid":1,"pid":2}]','true','1','"text"',''):
            with self.assertRaises((AssertionError,ValueError)):
                module.observer_json(invalid)

    def test_acceptance_requires_reference_and_both_complete_matrix_cases(self):
        spec=importlib.util.spec_from_file_location('review_cli_coverage_test',SOURCE/'run-secondary-review-cli-atomicity.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        self.assertEqual(module.planned_cases('acceptance'),('reference','empty205','populated205'))
        ref=dict(kind='controlled-review-cli205-reference-v1',passed=True,ledger_rows=205,retained205_statement_count=94)
        proof=dict(kind='controlled-review-cli206-atomicity-v1',passed=True,exact_retry_noop=True,
                   private_acl_and_empty_operations_verified_before_after_retry=True,
                   retained205_statement_count=94,installed206_statement_count=304,original205_rows_preserved=True,
                   failures=[dict(case=n,sqlstate='P0001',armed_full_rollback=True,cleaned_baseline_exact=True)for n in ('late_body','ledgerfault')],
                   attachment206_clones=[dict(helper=n,passed=True,source_full_snapshot_unchanged=True,private206_empty_schema_data_restored=True)for n in
                       ('ezyvet_attachment_metadata_concurrency.py','ezyvet_attachment_originals_concurrency.py')])
        cases=[dict(case=n,proof=copy.deepcopy(proof))for n in ('empty205','populated205')]
        self.assertTrue(module.completed_coverage('acceptance',[ref,*cases]))
        self.assertTrue(module.completed_coverage('measurement',cases))
        for bad in (cases,[ref,cases[0]],[ref,*reversed(cases)],[ref,ref,*cases]):
            with self.assertRaises(AssertionError):module.completed_coverage('acceptance',bad)
        bad=copy.deepcopy([ref,*cases]);bad[1]['proof']['attachment206_clones'].pop()
        with self.assertRaises(AssertionError):module.completed_coverage('acceptance',bad)
        for key,value in (('retained205_statement_count',93),('installed206_statement_count',303),
                          ('original205_rows_preserved',False),('failures',proof['failures'][:1])):
            bad=copy.deepcopy([ref,*cases]);bad[2]['proof'][key]=value
            with self.assertRaises(AssertionError):module.completed_coverage('acceptance',bad)
        bad=copy.deepcopy([ref,*cases]);bad[1]['proof']['attachment206_clones'][1]['private206_empty_schema_data_restored']=False
        with self.assertRaises(AssertionError):module.completed_coverage('acceptance',bad)

    def test_acceptance_cannot_borrow_unused_phase_time_or_cleanup_reserve(self):
        spec=importlib.util.spec_from_file_location('review_cli_deadline_test',SOURCE/'run-secondary-review-cli-atomicity.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        module.acceptance_deadline_check(599.9,600,1800)
        module.acceptance_deadline_check(1199.9,1200,1800)
        for now,phase,total in ((600,600,1800),(601,600,1800),(1201,1200,1800),(1800,2000,1800)):
            with self.assertRaises(AssertionError):module.acceptance_deadline_check(now,phase,total)
        process=subprocess.run([sys.executable,'-B',str(SOURCE/'run-secondary-review-cli-atomicity.py'),
            '--run-synthetic-local','--acceptance','--reference-evidence','/nonexistent-private-receipt'],capture_output=True,text=True)
        self.assertNotEqual(process.returncode,0)
        self.assertNotIn('Protected evidence:',process.stdout)

    def test_new_runner_is_import_safe_and_modes_are_separate(self):
        spec=importlib.util.spec_from_file_location('review_cli_runner_test',SOURCE/'run-secondary-review-cli-atomicity.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        self.assertEqual(module.REFERENCE_WORKLOAD_SECONDS,600)
        self.assertEqual(module.MEASUREMENT_WORKLOAD_SECONDS,1200)
        self.assertEqual(module.CLEANUP_RESERVE_SECONDS,180)
        for args in ([],['--run-synthetic-local','--reference','--measurement']):
            process=subprocess.run([sys.executable,'-B',str(SOURCE/'run-secondary-review-cli-atomicity.py'),*args],capture_output=True,text=True)
            self.assertEqual(process.returncode,2)
            self.assertNotIn('Protected evidence:',process.stdout)


if __name__=='__main__':unittest.main()
