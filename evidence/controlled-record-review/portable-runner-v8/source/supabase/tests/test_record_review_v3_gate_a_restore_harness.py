"""Restore contract tests with no database, process, or provider calls."""
import copy
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest

ROOT=Path(__file__).resolve().parents[2]
SOURCE=ROOT/'tests/controlled-drugs/engine/candidate'
sys.path.insert(0,str(SOURCE))
import record_review_v3_gate_a_restore as m
import record_review_v3_gate_a_admission as admission


class RecordReviewV3RestoreTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.package=admission.admit()['package']

    def state(self):
        expected=self.package['expected']
        parent=expected['parents']['parent205']['manifest']
        private=expected['parents']['private206']
        rows={'auth.users':[{'id':'synthetic-user','private':'not-for-public-report'}],
              'auth.sessions':[],
              **{'controlled_review.'+n:[] for n in ('definitions','preparations','decisions','cancellations')},
              'controlled_review.descriptor':[{'id':True,'definition':private}],
              **{'controlled_review_v3.'+n:[] for n in m.assembly.descriptor.TABLES},
              'controlled_review_v3.descriptor':[{'id':True,'definition':expected}]}
        return dict(catalog={'schemas':{n:{'oid':1} for n in m.SCOPES},'functions':{},'relations':{}},
            rows=rows,types={'controlled_review_v3.descriptor':{'oid':10}},ledger=self.package['expected_ledger206'],
            parent=parent,parent_literal=[dict(revision=1,definition=parent,definition_hash='a'*64,recorded_at='retained')],
            parent_literal_hash_valid=True,
            writers=json.loads((SOURCE/'release-expected-204.json').read_text())['canonical_writer_definition_hashes'],
            private206=private,private206_literal=[{'id':True,'definition':private}])

    def owners(self):
        entries=[dict(kind='schema',identity=n,owner=o,acl=None,detail=None,extension=None)for n,o in m.SCHEMA_OWNERS.items()]
        entries += [dict(kind='relation:r',identity='auth.users',owner='supabase_auth_admin',
            acl=['supabase_auth_admin=arwdDxt/supabase_auth_admin'],detail={'columns':{'id':None}},extension=None)]
        return dict(entries=entries,extensions=sorted(m.EXTENSION_PROFILE.values(),key=lambda e:e['name']))

    def counts(self):
        return dict(events=26,actions=26,preparations=30,kinds=dict(m.KIND_COUNTS),native_dispenses=2,
                    native_returns=10,native_discrepancies=5,native_annotations=3,receipts_validated=True)

    def test_parent_fixture_counts_exact_kind_set_not_adapter_credit(self):
        self.assertEqual(len(m.KIND_COUNTS),22)
        self.assertEqual(sum(m.KIND_COUNTS.values()),26)
        self.assertEqual(m.validate_seed_counts(self.counts()),self.counts())
        self.assertIn('controlled_stock_validate_event',m.SEED_CHECK_SQL)
        self.assertIn('read_controlled_stock_action',m.SEED_CHECK_SQL)
        self.assertIn('execute_controlled_stock_action',m.SEED_CHECK_SQL)
        self.assertTrue(m.SEED_CHECK_SQL.rstrip().endswith('rollback;'))

    def test_missing_or_replaced_kind_and_nonformal_count_refuse(self):
        for change in (
            lambda v:v.update(events=25),lambda v:v.update(events=26.0),
            lambda v:v.update(receipts_validated=1),lambda v:v['kinds'].pop('receive_inventory'),
            lambda v:v['kinds'].update(unknown=1),lambda v:v.update(native_returns=9)):
            value=self.counts();change(value)
            with self.assertRaises(AssertionError):m.validate_seed_counts(value)

    def test_valid_clone_may_have_different_oids_after_independent_checks(self):
        source=self.state();clone=self.state();clone['catalog']['schemas']['public']['oid']=900
        clone['types']['controlled_review_v3.descriptor']['oid']=901
        self.assertTrue(m.compare_clone(source,clone,self.owners(),self.owners(),self.package,self.package['expected']))

    def test_missing_v3_schema_descriptor_and_seeded_v3_refuse(self):
        for change in (
            lambda v:v['catalog']['schemas'].pop('controlled_review_v3'),
            lambda v:v['rows'].pop('controlled_review_v3.descriptor'),
            lambda v:v['rows'].update({'controlled_review_v3.descriptor':[]}),
            lambda v:v['rows'].update({'controlled_review_v3.preparations':[{'operation_id':'unreviewed'}]})):
            value=self.state();change(value)
            with self.assertRaises(AssertionError):m.validate_installed(value,self.package,self.package['expected'])

    def test_descriptor_singleton_booleans_and_parent_revision_are_formal(self):
        for change in (
            lambda v:v.update(parent_literal_hash_valid=1),
            lambda v:v['parent_literal'][0].update(revision=True),
            lambda v:v['private206_literal'][0].update(id=1),
            lambda v:v['rows']['controlled_review_v3.descriptor'][0].update(id=1)):
            value=self.state();change(value)
            with self.assertRaises(AssertionError):m.validate_installed(value,self.package,self.package['expected'])

    def test_full_ledger_old_private_parent_and_writer_drift_refuse(self):
        for change in (
            lambda v:v.update(ledger=v['ledger'][:-1]),
            lambda v:v.update(private206={}),lambda v:v.update(parent={}),lambda v:v.update(writers={}),
            lambda v:v['rows'].update({'controlled_review.definitions':[{}]})):
            value=self.state();change(value)
            with self.assertRaises(AssertionError):m.validate_installed(value,self.package,self.package['expected'])

    def test_changed_v3_ri_owner_acl_metadata_refuse(self):
        expected=self.package['expected']
        for key in ('foreign_key_triggers','functions','relations','schema'):
            observed=dict(expected);observed[key]={}
            with self.subTest(key=key),self.assertRaisesRegex(AssertionError,'v3 metadata'):
                m.validate_installed(self.state(),self.package,observed)

    def test_altered_clone_source_rows_and_descriptor_commitments_refuse(self):
        for change in (
            lambda v:v['rows']['auth.users'].append({'id':'extra'}),
            lambda v:v['parent_literal'][0].update(recorded_at='changed')):
            source=self.state();clone=self.state();change(clone)
            with self.assertRaisesRegex(AssertionError,'restored state'):
                m.compare_clone(source,clone,self.owners(),self.owners(),self.package,self.package['expected'])

    def test_fixed_schema_and_extension_profile_not_observed_fallback(self):
        self.assertEqual(m.admitted_ownership(self.owners()),self.owners())
        for change in (
            lambda v:v['entries'][0].update(owner='postgres'),
            lambda v:v['extensions'][0].update(version='unreviewed'),
            lambda v:v['extensions'][0].update(owner='postgres'),
            lambda v:v['extensions'].append(dict(name='extra',owner='postgres',schema='extensions',version='1'))):
            value=copy.deepcopy(self.owners());change(value)
            with self.assertRaises(AssertionError):m.admitted_ownership(value)
        self.assertIs(m.PROFILE_PROVENANCE['ownership_constants_proven_from_bootstrap_source'],False)
        self.assertIs(m.PROFILE_PROVENANCE['prior_live_owner_observation_is_authority'],False)

    def test_auth_owner_acl_null_grantor_and_column_acl_preserved(self):
        for change in (
            lambda e:e.update(owner='postgres'),lambda e:e.update(acl=None),
            lambda e:e.update(acl=['supabase_auth_admin=arwdDxt/postgres']),
            lambda e:e['detail']['columns'].update(id=['anon=r/supabase_auth_admin'])):
            before=self.owners();after=copy.deepcopy(before);change(after['entries'][-1])
            with self.assertRaisesRegex(AssertionError,'Auth owners/raw ACLs/column ACLs/grantors'):
                m.compare_clone(self.state(),self.state(),before,after,self.package,self.package['expected'])

    def test_native_dump_keeps_owner_before_acl_and_only_declared_rewrite(self):
        dump='CREATE SCHEMA public;\nALTER SCHEMA public OWNER TO pg_database_owner;\nCREATE SCHEMA extensions;\nALTER SCHEMA extensions OWNER TO postgres;\nCREATE SCHEMA controlled_review_v3;\nALTER TABLE auth.users OWNER TO supabase_auth_admin;\nGRANT SELECT ON auth.users TO postgres;\nALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT SELECT ON TABLES TO anon;\n-- CREATE SCHEMA public;\n'
        result=m.rewrite_dump(dump)
        self.assertIn('ALTER TABLE auth.users OWNER TO supabase_auth_admin;',result)
        self.assertIn('GRANT SELECT ON auth.users TO postgres;',result)
        self.assertNotIn('ALTER DEFAULT PRIVILEGES',result)
        self.assertIn('CREATE SCHEMA IF NOT EXISTS extensions;',result)
        self.assertIn('CREATE SCHEMA IF NOT EXISTS public;',result)
        self.assertIn('-- CREATE SCHEMA public;',result)
        expected=dump.splitlines()
        expected=[line.replace('CREATE SCHEMA ','CREATE SCHEMA IF NOT EXISTS ',1)
            if line in ('CREATE SCHEMA public;','CREATE SCHEMA extensions;') else line
            for line in expected if not line.startswith('ALTER DEFAULT PRIVILEGES')]
        self.assertEqual(result.splitlines(),expected)
        with self.assertRaisesRegex(AssertionError,'omitted v3'):
            m.rewrite_dump(dump.replace('CREATE SCHEMA controlled_review_v3;',''))
        sql=m.extension_bootstrap()
        self.assertIn('extensions authorization postgres',sql)
        self.assertIn('set local role supabase_admin',sql)
        self.assertNotIn('alter owner',sql.lower())

    def test_schema_rewrite_rejects_missing_duplicate_nonstandalone_or_wrong_owner(self):
        dump='CREATE SCHEMA public;\nALTER SCHEMA public OWNER TO pg_database_owner;\nCREATE SCHEMA extensions;\nALTER SCHEMA extensions OWNER TO postgres;\nCREATE SCHEMA controlled_review_v3;\nGRANT SELECT ON auth.users TO postgres;\n'
        for name in ('public','extensions'):
            statement='CREATE SCHEMA '+name+';'
            for altered in (dump.replace(statement,''),dump+statement+'\n',
                dump.replace(statement,'-- '+statement),dump.replace(statement,' '+statement)):
                with self.subTest(name=name),self.assertRaises(AssertionError):m.rewrite_dump(altered)
        with self.assertRaisesRegex(AssertionError,'owner statement'):
            m.rewrite_dump(dump.replace('public OWNER TO pg_database_owner','public OWNER TO postgres'))

    def test_fixed_four_extension_realization_and_profile_refusal(self):
        sql=m.extension_bootstrap()
        self.assertEqual(sql.count('create extension '),4)
        self.assertIn('create schema public authorization pg_database_owner;',sql)
        for name in ('pgcrypto','uuid-ossp','pg_net','pg_stat_statements'):
            profile=m.EXTENSION_PROFILE[name]
            quoted='"uuid-ossp"' if name=='uuid-ossp' else name
            statement='create extension '+quoted+' with schema '+profile['schema']+" version '"+profile['version']+"';"
            self.assertIn(statement,sql)
            self.assertLess(sql.index('set local role supabase_admin;'),sql.index(statement))
            self.assertLess(sql.index(statement),sql.index('reset role;'))
        for forbidden in ('cascade','if not exists','alter owner','alter extension'):
            self.assertNotIn(forbidden,sql.lower())
        profile=copy.deepcopy(list(m.EXTENSION_PROFILE.values()))
        self.assertEqual(m.validate_extension_profile(profile),profile)
        for change in (lambda v:v.pop(),lambda v:v.append(copy.deepcopy(v[0])),
            lambda v:v[0].update(owner='postgres'),lambda v:v[0].update(version='unknown'),
            lambda v:v[0].update(schema='public'),lambda v:v[0].update(extra=True),
            lambda v:v.append(dict(name='unreviewed',owner='supabase_admin',schema='public',version='1'))):
            value=copy.deepcopy(profile);change(value)
            with self.assertRaises(AssertionError):m.validate_extension_profile(value)

    def test_cleanup_rejects_foreign_name_and_marker(self):
        class Runtime:
            def __init__(self):self.databases={'owned_review_restore_0123456789':'expected'};self.calls=[]
            def query(self,sql):self.calls.append(sql);return 'wrong\n'
        runtime=Runtime()
        with self.assertRaises(AssertionError):m.drop_clone(runtime,'postgres','expected')
        self.assertEqual(runtime.calls,[])
        with self.assertRaisesRegex(AssertionError,'marker changed'):
            m.drop_clone(runtime,'owned_review_restore_0123456789','expected')
        self.assertFalse(any(s.startswith('drop database')for s in runtime.calls))
        self.assertIn('owned_review_restore_0123456789',runtime.databases)

    def test_restore_primary_error_binds_code_and_exact_message(self):
        message='Record-review v3 Gate A metadata differs from independent descriptor'
        def result(stderr,returncode=1):return SimpleNamespace(returncode=returncode,stderr=stderr)
        m.restore_primary_failure(result('ERROR:  23514: '+message+'\nCONTEXT: harmless context\n'),'23514',message)
        for stderr in (
            'ERROR:  23514: unrelated failure\nCONTEXT: '+message+'\n',
            'ERROR:  42501: unrelated failure\nCONTEXT: ERROR: 23514: '+message+'\n',
            'echo ERROR: 23514: '+message+'\n',
            'ERROR:  23514: '+message+' extra unexpected text\n',
            'ERROR:  23514: '+message+'\nERROR:  42501: second primary\n'):
            with self.subTest(stderr=stderr),self.assertRaises(AssertionError):
                m.restore_primary_failure(result(stderr),'23514',message)
        with self.assertRaises(AssertionError):
            m.restore_primary_failure(result('ERROR: 23514: '+message+'\n',0),'23514',message)

    def test_restore_matrix_requires_exact_nine_cases_and_formal_proofs(self):
        expected=('missing_schema','missing_descriptor','disabled_child_ri','disabled_parent_ri',
            'changed_private_owner','changed_private_acl','changed_private_column_acl','auth_owner','auth_column_acl')
        self.assertEqual(m.RESTORE_REFUSAL_CASES,expected)
        results=[dict(case=name,rollback_exact=True,**(
            {'sqlstate':'3F000' if index==0 else '23514'} if index<7 else {'comparison_refused':True}))
            for index,name in enumerate(expected)]
        self.assertEqual(m.validate_refusal_matrix(results),list(expected))
        for change in (
            lambda v:v.pop(),lambda v:v.append(copy.deepcopy(v[0])),lambda v:v.reverse(),
            lambda v:v[1].update(case='missing_schema'),lambda v:v[0].update(sqlstate='23514'),
            lambda v:v[0].update(rollback_exact=1),lambda v:v[7].update(comparison_refused=1),
            lambda v:v[2].update(extra=True),lambda v:v[8].pop('comparison_refused')):
            value=copy.deepcopy(results);change(value)
            with self.assertRaises(AssertionError):m.validate_refusal_matrix(value)


if __name__=='__main__':unittest.main()
