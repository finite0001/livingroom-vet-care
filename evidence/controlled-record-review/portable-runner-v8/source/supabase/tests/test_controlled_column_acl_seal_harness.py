"""Pure callback contracts for actual post-install column-ACL drift probes."""
import copy
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import unittest

PATH = Path(__file__).resolve().parents[2] / 'tests/controlled-drugs/engine/candidate/column_acl_seal.py'
sys.path.insert(0, str(PATH.parent))
SPEC = importlib.util.spec_from_file_location('column_acl_seal', PATH)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)


def baseline(phase='installed'):
    live = {'version': 2, 'functions': {'f' + str(i): {} for i in range(171)},
            'relations': {'r' + str(i): {'columns': [{'name': 'id', 'column_acl': []}]} for i in range(51)}}
    return {'rows': {name: {'count': 0, 'hash': 'a' * 64} for name in ('public.controlled_stock_events', 'auth.users', 'storage.objects')},
            'ledger': {'present': phase == 'installed', 'rows': [{'version': str(i)} for i in range(204)] if phase == 'installed' else None},
            'writers': {'writer' + str(i): 'b' * 64 for i in range(10)},
            'stored_manifest': [{'definition': live, 'definition_hash': 'c' * 64, 'revision': 1}],
            'live_manifest': live, 'implicit_owner_access': True,
            'public_catalog': {'schema': {'owner': 'PRIVATE OWNER'}, 'functions': {'private_function': 'RAW PRIVATE DEFINITION'},
                               'relations': {'private_relation': {'columns': {'secret_id': 'PRIVATE ACL'}}}}}


class Callbacks:
    def __init__(self, phase='installed'):
        self.phase = phase
        self.base = baseline(phase)
        self.after = copy.deepcopy(self.base)
        self.sql_calls = []
        self.raw_calls = []
        self.failure_transform = None

    def sql(self, query):
        self.sql_calls.append(query)
        return json.dumps(self.base if len(self.sql_calls) == 1 else self.after)

    def raw(self, query):
        self.raw_calls.append(query)
        label = re.search(r'Column ACL seal armed: ([a-z_]+)', query)[1]
        result = subprocess.CompletedProcess([], 3, '', f'NOTICE:  00000: Column ACL seal armed: {label}\nERROR:  23514: {m.MESSAGE}\n')
        return self.failure_transform(result) if self.failure_transform else result

    def probe(self, **kwargs):
        return m.probe_column_acl_seal(self.sql, self.raw, 'PRIVATE prior SQL not executed', phase=self.phase, **kwargs)


class ColumnAclSealTests(unittest.TestCase):
    def test_installed_six_actual_grant_cases_with_exact_rollback(self):
        c = Callbacks()
        proof = c.probe()
        self.assertEqual(len(c.raw_calls), 6)
        self.assertEqual(len(c.sql_calls), 7)
        self.assertEqual(proof['ledger_rows'], 204)
        self.assertTrue(proof['ledger_present'])
        self.assertEqual([item['case'] for item in proof['outcomes']], [case[0] for case in m.CASES])
        self.assertTrue(all(query.startswith('\\set VERBOSITY verbose\nbegin;') for query in c.raw_calls))
        self.assertNotIn('PRIVATE OWNER', json.dumps(proof))
        self.assertNotIn('RAW PRIVATE', json.dumps(proof))
        self.assertNotIn('secret_id', json.dumps(proof))

    def canonical_context(self, callbacks):
        from canonical_prefix import canonical_binding
        binding = canonical_binding(PATH.parent, sorted((PATH.parents[4] / 'supabase/migrations').glob('*.sql')))
        original = [{'version': f'{i:014d}', 'name': 'old', 'statements': ['original']} for i in range(204)]
        callbacks.base['ledger'] = {'present': True, 'rows': copy.deepcopy(original) + [
            {'version': binding['version'], 'name': binding['name'], 'statements': binding['expected_statements']}]}
        callbacks.after = copy.deepcopy(callbacks.base)
        return {'original_rows': original, 'binding': binding}

    def test_canonical205_requires_explicit_mode_and_exact_original_ledger(self):
        c = Callbacks()
        context = self.canonical_context(c)
        proof = c.probe(ledger_mode='canonical205', canonical_ledger=context)
        self.assertEqual(proof['ledger_rows'], 205)
        self.assertEqual(proof['ledger_mode'], 'canonical205')
        self.assertIs(proof['canonical_ledger_verified'], True)
        self.assertEqual(len(c.raw_calls), 6)
        self.assertNotIn('original_rows', json.dumps(proof))
        c = Callbacks()
        self.canonical_context(c)
        with self.assertRaises(AssertionError):
            c.probe()
        with self.assertRaises(AssertionError):
            c.probe(ledger_mode='canonical205')

    def test_canonical205_rejects_wrong_record_and_changed_prior_row(self):
        for field in ('name', 'version', 'statements', 'oldrow'):
            c = Callbacks()
            context = self.canonical_context(c)
            if field == 'oldrow':
                c.base['ledger']['rows'][0]['name'] = 'changed'
            else:
                c.base['ledger']['rows'][-1][field] = ['wrong'] if field == 'statements' else 'wrong'
            c.after = copy.deepcopy(c.base)
            with self.assertRaises(AssertionError):
                c.probe(ledger_mode='canonical205', canonical_ledger=context)
            self.assertEqual(c.raw_calls, [])

    def test_canonical205_checks_ledger_again_after_every_refusal(self):
        c = Callbacks()
        context = self.canonical_context(c)
        c.after['ledger']['rows'][0]['name'] = 'changed'
        with self.assertRaises(AssertionError):
            c.probe(ledger_mode='canonical205', canonical_ledger=context)

    def test_explicit_absent_restore_mode_is_separate_from_canonical205(self):
        c = Callbacks('populated_restore')
        proof = c.probe(ledger_mode='absent_restore')
        self.assertEqual(proof['ledger_mode'], 'absent_restore')
        self.assertFalse(proof['canonical_ledger_verified'])
        with self.assertRaises(AssertionError):
            c.probe(ledger_mode='canonical205', canonical_ledger={})
        with self.assertRaises(AssertionError):
            Callbacks().probe(ledger_mode='absent_restore')

    def test_actual_sql_observes_direct_acl_and_effective_permissions_before_arming(self):
        c = Callbacks()
        c.probe()
        for query in c.raw_calls:
            self.assertIn('from aclexplode(after_acl)', query)
            self.assertIn('after_acl is not distinct from prior_acl', query)
            self.assertIn('has_column_privilege(', query)
            self.assertIn('has_table_privilege(', query)
            self.assertIn('controlled_stock_manifest_snapshot()is not distinct from live_before', query)
            self.assertLess(query.index('direct_seen is distinct from true'), query.index('raise notice'))
            self.assertLess(query.index('raise notice'), query.index('perform controlled_stock_manifest_required();'))
            self.assertNotIn('update controlled_stock_engine_manifests', query.lower())
            self.assertNotIn('disable trigger', query.lower())

    def test_owner_case_preserves_implicit_access_and_does_not_require_table_denial(self):
        query = m._mutation(m.CASES[-1])
        self.assertIn('pg_get_userbyid(owner_id)', query)
        self.assertIn("has_table_privilege(pg_get_userbyid(owner_id),rel,'SELECT')is distinct from true", query)
        self.assertIn('a.grantee=owner_id', query)
        self.assertTrue(Callbacks().probe()['implicit_owner_access_preserved'])

    def test_public_case_observes_pseudo_grantee_zero_and_effective_authenticated_access(self):
        query = m._mutation(m.CASES[1])
        self.assertIn(' to PUBLIC;', query)
        self.assertIn('a.grantee=0', query)
        self.assertIn("has_column_privilege('authenticated',rel,'id','SELECT')", query)
        self.assertIn("has_table_privilege('authenticated',rel,'SELECT')is distinct from false", query)

    def test_option_and_old_source_cases_are_actual_distinct_sql(self):
        self.assertIn('with grant option;', m._mutation(m.CASES[4]))
        self.assertIn('or not option_seen', m._mutation(m.CASES[4]))
        query = m._mutation(m.CASES[4])
        self.assertLess(query.index('grant select(id)on public.controlled_stock_events to authenticated;'), query.index('with grant option;'))
        self.assertIn("a->'grantable'='false'::jsonb", query)
        self.assertIn("jsonb_set(a,'{grantable}','true'::jsonb)", query)
        self.assertIn('controlled_stock_manifest_snapshot()is distinct from expected_live', query)
        self.assertLess(query.index('Only column grantability metadata must advance'), query.index('raise notice'))
        self.assertIn('public.stock_writer_admissions', m._mutation(m.CASES[3]))
        self.assertIn('select(source_id)', m._mutation(m.CASES[3]))

    def test_populated_restore_preserves_ledger_absence_without_manufacturing_it(self):
        c = Callbacks('populated_restore')
        proof = c.probe()
        self.assertFalse(proof['ledger_present'])
        self.assertEqual(proof['ledger_rows'], 0)
        self.assertIn("to_regclass('supabase_migrations.schema_migrations')is null", c.sql_calls[0])
        self.assertNotIn('create schema supabase_migrations', c.sql_calls[0].lower())

    def test_populated_restore_may_preserve_an_actual_existing_ledger(self):
        c = Callbacks('populated_restore')
        c.base['ledger'] = baseline()['ledger']
        c.after = copy.deepcopy(c.base)
        self.assertTrue(c.probe()['ledger_present'])

    def test_installed_phase_cannot_ignore_a_missing_ledger(self):
        c = Callbacks()
        c.base['ledger'] = {'present': False, 'rows': None}
        with self.assertRaises(AssertionError):
            c.probe()
        self.assertEqual(c.raw_calls, [])

    def test_manifest_version_and_every_column_acl_field_required(self):
        for change in ['old_version', 'missing_column_acl']:
            c = Callbacks()
            if change == 'old_version':
                c.base['live_manifest']['version'] = 1
            else:
                del c.base['live_manifest']['relations']['r0']['columns'][0]['column_acl']
            with self.assertRaises(AssertionError):
                c.probe()
            self.assertEqual(c.raw_calls, [])

    def test_no_initial_owner_access_is_a_failure_not_a_success_control(self):
        c = Callbacks()
        c.base['implicit_owner_access'] = False
        with self.assertRaises(AssertionError):
            c.probe()

    def test_success_or_wrong_sqlstate_or_message_cannot_count_as_refusal(self):
        transforms = [lambda r: subprocess.CompletedProcess([], 0, '', r.stderr),
                      lambda r: subprocess.CompletedProcess([], True, '', r.stderr),
                      lambda r: subprocess.CompletedProcess([], 3, '', r.stderr.replace('23514', 'P0003')),
                      lambda r: subprocess.CompletedProcess([], 3, '', r.stderr.replace(m.MESSAGE, 'Different guard'))]
        for transform in transforms:
            c = Callbacks()
            c.failure_transform = transform
            with self.assertRaises(AssertionError):
                c.probe()

    def test_missing_observed_grant_notice_and_context_only_error_rejected(self):
        for transform in [lambda r: subprocess.CompletedProcess([], 3, '', r.stderr.splitlines()[1]),
                          lambda r: subprocess.CompletedProcess([], 3, '', r.stderr.replace('ERROR:', 'CONTEXT:'))]:
            c = Callbacks()
            c.failure_transform = transform
            with self.assertRaises(AssertionError):
                c.probe()

    def test_all_private_preservation_domains_are_compared(self):
        mutations = [lambda x: x['rows']['auth.users'].update(hash='d' * 64),
                     lambda x: x['writers'].update(writer0='d' * 64),
                     lambda x: x['ledger']['rows'][0].update(version='changed'),
                     lambda x: x['stored_manifest'][0].update(revision=2),
                     lambda x: x['public_catalog']['relations'].update(extra='survivor'),
                     lambda x: x['public_catalog']['relations']['private_relation']['columns'].update(secret_id='CHANGED ACL')]
        for mutate in mutations:
            c = Callbacks()
            mutate(c.after)
            with self.assertRaises(AssertionError):
                c.probe()

    def test_restore_cannot_gain_a_ledger_after_refusal(self):
        c = Callbacks('populated_restore')
        c.after['ledger'] = baseline()['ledger']
        with self.assertRaises(AssertionError):
            c.probe()

    def test_last_owner_refusal_is_required_before_any_pass(self):
        c = Callbacks()
        c.failure_transform = lambda r: subprocess.CompletedProcess([], 3, '', r.stderr.replace('23514', '42501')) if 'armed: explicit_owner_column' in r.stderr else r
        with self.assertRaises(AssertionError):
            c.probe()
        self.assertEqual(len(c.raw_calls), 6)

    def test_strict_public_proof_types_missing_case_and_order(self):
        proof = Callbacks().probe()
        for key, value in [('passed', 1), ('refusal_count', True), ('ledger_present', 1), ('ledger_rows', True),
                           ('manifest_version', 1), ('manifest_never_resealed', 1), ('grant_option_only_metadata_flip_verified', False), ('hosted_writes', False)]:
            bad = copy.deepcopy(proof)
            bad[key] = value
            with self.assertRaises(AssertionError):
                m.validate_proof(bad)
        bad = copy.deepcopy(proof)
        bad['outcomes'].pop()
        with self.assertRaises(AssertionError):
            m.validate_proof(bad)
        bad = copy.deepcopy(proof)
        bad['outcomes'].reverse()
        with self.assertRaises(AssertionError):
            m.validate_proof(bad)

    def test_outcome_booleans_cannot_be_forged_as_integers(self):
        proof = Callbacks().probe()
        proof['outcomes'][0]['actual_direct_acl_and_effective_column_select_observed'] = 1
        with self.assertRaises(AssertionError):
            m.validate_proof(proof)

    def test_option_case_cannot_claim_a_plain_grant_as_grantability_proof(self):
        proof = Callbacks().probe()
        proof['outcomes'][4]['grant_option_only_metadata_flip_observed'] = False
        with self.assertRaises(AssertionError):
            m.validate_proof(proof)

    def test_unknown_phase_or_extra_public_fields_rejected(self):
        c = Callbacks()
        c.phase = 'hosted'
        with self.assertRaises(AssertionError):
            c.probe()
        proof = Callbacks().probe()
        proof['raw_catalog'] = c.base['public_catalog']
        with self.assertRaises(AssertionError):
            m.validate_proof(proof)

    def test_duplicate_or_multiple_snapshot_records_cannot_pass(self):
        for output in ['{"rows":{},"rows":{}}', '{}\n{}']:
            with self.assertRaises(AssertionError):
                m._json(output)


if __name__ == '__main__':
    unittest.main()
