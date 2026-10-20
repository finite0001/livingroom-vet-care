"""Pure callback tests for release rollback and independent installed verification."""
import copy
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import unittest

PATH = Path(__file__).resolve().parents[2] / 'tests/controlled-drugs/engine/candidate/release_rehearsal.py'
SPEC = importlib.util.spec_from_file_location('release_rehearsal', PATH)
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
PRIOR_SQL = 'create function pg_temp.controlled_stock_prior_snapshot()returns jsonb language sql as $$select null::jsonb$$;'
ARTIFACT = 'begin;\n' + '\n'.join(m.MARKERS.values()) + '\ncommit;'


def baseline():
    return {'relations': {name: {'count': 0, 'hash': 'a' * 64} for name in
                          ('public.original', 'auth.users', 'storage.objects', 'extensions.fixture')},
            'prior': {'functions': {'private_original': 'PRIVATE OWNER ACL'}, 'relations': {}},
            'writers': {'public.writer' + str(i) + '()': 'b' * 64 for i in range(10)},
            'ledger': [{'version': str(i)} for i in range(204)],
            'engine_catalog': {'relations': [], 'functions': [], 'triggers': []}}


class Callbacks:
    def __init__(self):
        self.before = baseline()
        self.after = copy.deepcopy(self.before)
        self.raw_queries = []
        self.bad_result = None

    def sql(self, query):
        return json.dumps(self.after)

    def raw(self, query):
        self.raw_queries.append(query)
        label = re.search(r'rehearsal armed: ([a-z_]+)', query)[1]
        cases = m.MUTATIONS if label in m.MUTATIONS else m.POST_MUTATIONS
        state, message = ('23514', cases[label][1]) if label in cases else ('P0001', m.INJECTED_MESSAGE)
        result = subprocess.CompletedProcess([], 3, '', f'NOTICE:  00000: Controlled release rehearsal armed: {label}\nERROR:  {state}: {message}\n')
        if self.bad_result:
            return self.bad_result(result)
        return result

    def rehearse(self, artifact=ARTIFACT):
        return m.rehearse_failures(self.sql, self.raw, artifact, PRIOR_SQL, {'definition': self.before['prior']}, self.before)


class ReleaseRehearsalTests(unittest.TestCase):
    def test_capture_original_private_baseline(self):
        c = Callbacks()
        self.assertEqual(m.capture_baseline(c.sql, PRIOR_SQL, {'definition': c.before['prior']}), c.before)

    def test_capture_rejects_drift_before_deliberate_failures(self):
        c = Callbacks()
        with self.assertRaises(AssertionError):
            m.capture_baseline(c.sql, PRIOR_SQL, {'definition': {}})

    def test_capture_rejects_existing_permanent_engine_catalog(self):
        for key in ('relations', 'functions', 'triggers'):
            c = Callbacks()
            c.after['engine_catalog'][key].append('existing')
            with self.assertRaises(AssertionError):
                m.capture_baseline(c.sql, PRIOR_SQL, {'definition': c.before['prior']})

    def test_all_fourteen_exact_refusals_and_three_distinct_ddl_stages(self):
        c = Callbacks()
        proof = c.rehearse()
        self.assertEqual(len(c.raw_queries), 14)
        self.assertEqual([x['case'] for x in proof['failure_cases']], list(m.CASE_ORDER))
        self.assertTrue(all(query.startswith('\\set VERBOSITY verbose\nbegin;') for query in c.raw_queries))
        for query, phase in zip(c.raw_queries[6:9], m.PHASES):
            self.assertGreater(query.index(m.INJECTED_MESSAGE), query.index(m.MARKERS['preflight']))
            self.assertIn('armed: ' + phase, query)
        self.assertNotIn('PRIVATE OWNER ACL', json.dumps(proof))
        self.assertNotIn('private_original', json.dumps(proof))

    def test_five_post_install_mutations_reach_their_exact_comparison(self):
        c = Callbacks()
        proof = c.rehearse()
        self.assertEqual(len(m.POST_MUTATIONS), 5)
        for query, label, outcome in zip(c.raw_queries[9:], m.POST_MUTATIONS, proof['failure_cases'][9:]):
            mutation, message = m.POST_MUTATIONS[label]
            self.assertGreater(query.index(mutation), query.index(m.MARKERS['after_hooks']))
            self.assertLess(query.index(mutation), query.index(m.MARKERS['before_postcheck']))
            self.assertEqual(outcome['stage'], 'before_postcheck')
            self.assertEqual(outcome['sqlstate'], '23514')
            self.assertEqual(outcome['message'], message)

    def test_column_acl_case_requires_the_independent_private_access_guard(self):
        c = Callbacks()
        def wrong_guard(result):
            if 'armed: post_column_grant' in result.stderr:
                return subprocess.CompletedProcess([], result.returncode, '', result.stderr.replace('Controlled release private access or RLS changed', 'Controlled release installed metadata differs from reviewed artifact'))
            return result
        c.bad_result = wrong_guard
        with self.assertRaises(AssertionError):
            c.rehearse()
        self.assertEqual(len(c.raw_queries), 14)
        self.assertIn('grant select(id)on public.controlled_stock_events to authenticated;', c.raw_queries[-1])

    def test_post_install_mutation_cannot_pass_on_an_unrelated_error(self):
        c = Callbacks()
        def corrupt_post(result):
            if 'armed: post_helper_grant' in result.stderr:
                return subprocess.CompletedProcess([], result.returncode, '', result.stderr.replace('Controlled release installed metadata differs from reviewed artifact', 'Permission denied'))
            return result
        c.bad_result = corrupt_post
        with self.assertRaises(AssertionError):
            c.rehearse()
        self.assertEqual(len(c.raw_queries), 11)

    def test_post_install_rollback_must_remove_all_new_catalog_objects(self):
        c = Callbacks()
        def leave_partial(result):
            if 'armed: post_column_grant' in result.stderr:
                c.after['engine_catalog']['triggers'] = ['survivor']
            return result
        c.bad_result = leave_partial
        with self.assertRaises(AssertionError):
            c.rehearse()
        self.assertEqual(len(c.raw_queries), 14)

    def test_proof_cannot_relabel_a_postcheck_failure_as_a_preflight(self):
        proof = Callbacks().rehearse()
        proof['failure_cases'][9]['stage'] = 'preflight'
        with self.assertRaises(AssertionError):
            m.validate_failure_proof(proof)

    def test_dirty_supplied_baseline_cannot_claim_empty_rollback(self):
        c = Callbacks()
        c.before['engine_catalog']['relations'] = ['preexisting']
        c.after = copy.deepcopy(c.before)
        with self.assertRaises(AssertionError):
            c.rehearse()
        self.assertEqual(c.raw_queries, [])

    def test_last_ddl_phase_failure_is_required_before_proof(self):
        c = Callbacks()
        def corrupt_last(result):
            if 'armed: before_commit' in result.stderr:
                return subprocess.CompletedProcess([], result.returncode, '', result.stderr.replace('P0001', '23514'))
            return result
        c.bad_result = corrupt_last
        with self.assertRaises(AssertionError):
            c.rehearse()
        self.assertEqual(len(c.raw_queries), 9)

    def test_backend_success_cannot_be_a_refusal(self):
        c = Callbacks()
        c.bad_result = lambda r: subprocess.CompletedProcess([], 0, r.stdout, r.stderr)
        with self.assertRaises(AssertionError):
            c.rehearse()

    def test_nonzero_bool_is_not_a_return_code(self):
        c = Callbacks()
        c.bad_result = lambda r: subprocess.CompletedProcess([], True, '', r.stderr)
        with self.assertRaises(AssertionError):
            c.rehearse()

    def test_wrong_sqlstate_or_message_cannot_pass(self):
        for old, new in [('23514', '40001'), (m.DRIFT_MESSAGE, 'Different error')]:
            c = Callbacks()
            c.bad_result = lambda r: subprocess.CompletedProcess([], r.returncode, '', r.stderr.replace(old, new))
            with self.assertRaises(AssertionError):
                c.rehearse()

    def test_error_only_in_context_does_not_pass(self):
        c = Callbacks()
        c.bad_result = lambda r: subprocess.CompletedProcess([], r.returncode, '', r.stderr.replace('ERROR:', 'CONTEXT:'))
        with self.assertRaises(AssertionError):
            c.rehearse()

    def test_missing_armed_notice_cannot_pass(self):
        c = Callbacks()
        c.bad_result = lambda r: subprocess.CompletedProcess([], r.returncode, '', r.stderr.splitlines()[1] + '\n')
        with self.assertRaises(AssertionError):
            c.rehearse()

    def test_missing_duplicate_or_reordered_stage_cannot_pass(self):
        for artifact in [ARTIFACT.replace(m.MARKERS['after_schema'], ''), ARTIFACT + m.MARKERS['before_commit'],
                         ARTIFACT.replace(m.MARKERS['after_schema'], 'TEMP').replace(m.MARKERS['after_hooks'], m.MARKERS['after_schema']).replace('TEMP', m.MARKERS['after_hooks'])]:
            with self.assertRaises(AssertionError):
                Callbacks().rehearse(artifact)

    def test_every_private_preservation_component_is_compared(self):
        for key in ('relations', 'prior', 'writers', 'ledger', 'engine_catalog'):
            c = Callbacks()
            if key == 'relations':
                c.after[key]['public.original']['hash'] = 'c' * 64
            elif key == 'prior':
                c.after[key]['changed'] = True
            elif key == 'writers':
                c.after[key]['public.writer0()'] = 'c' * 64
            elif key == 'ledger':
                c.after[key][0]['version'] = 'changed'
            else:
                c.after[key]['functions'].append('partial_survivor')
            with self.assertRaises(AssertionError, msg=key):
                c.rehearse()

    def test_missing_relation_cannot_be_normalized_away(self):
        c = Callbacks()
        del c.after['relations']['storage.objects']
        with self.assertRaises(AssertionError):
            c.rehearse()

    def test_boolean_relation_count_rejected(self):
        c = Callbacks()
        c.after['relations']['public.original']['count'] = False
        with self.assertRaises(AssertionError):
            c.rehearse()

    def test_failure_proof_types_and_missing_case(self):
        proof = Callbacks().rehearse()
        for key, value in [('failure_count', True), ('hosted_writes', False), ('passed', 1), ('baseline_relation_count', True)]:
            bad = copy.deepcopy(proof)
            bad[key] = value
            with self.assertRaises(AssertionError):
                m.validate_failure_proof(bad)
        bad = copy.deepcopy(proof)
        bad['failure_cases'].pop()
        with self.assertRaises(AssertionError):
            m.validate_failure_proof(bad)

    def test_json_duplicate_fields_and_extra_stdout_rejected(self):
        for output in ['{"relations":{},"relations":{}}', '{}\n{}']:
            with self.assertRaises(AssertionError):
                m._json(output)


class InstalledTests(unittest.TestCase):
    def setUp(self):
        self.before = baseline()
        self.expected = {'kind': 'controlled-stock-release-expected-204-v1', 'baseline_migration_count': 204,
                         'expected_technical_manifest': {'version': 1, 'functions': {'private': {}}, 'relations': {'engine': {}}},
                         'canonical_writer_definition_hashes': self.before['writers']}
        self.checks = {'manifest_rows': 1, 'literal_manifest_matches': True, 'live_manifest_matches': True,
                       'all_ten_hooks_pinned': True, 'raw_rpcs_private': True, 'raw_tables_private': True,
                       'zero_configuration_events_and_activation': True}
        self.installed = copy.deepcopy(self.before)
        self.installed['prior'] = None
        self.installed['relations']['public.controlled_stock_engine_manifests'] = {'count': 1, 'hash': 'c' * 64}
        self.installed['engine_catalog']['relations'] = ['controlled_stock_engine_manifests']
        self.installed['engine_catalog']['functions'] = ['controlled_stock_manifest_snapshot()']
        self.queries = []

    def sql(self, query):
        self.queries.append(query)
        return json.dumps(self.checks if len(self.queries) == 1 else self.installed)

    def verify(self):
        return m.verify_installed(self.sql, self.expected, self.before)

    def test_successful_install_is_independently_pinned_private_and_empty(self):
        proof = self.verify()
        self.assertEqual(proof['canonical_writers'], 10)
        self.assertTrue(proof['original_source_relations_and_ledger_preserved'])
        self.assertIn('definition_hash=controlled_stock_hash(', self.queries[0])
        self.assertIn("has_function_privilege('service_role'", self.queries[0])
        self.assertIn('not c.relrowsecurity', self.queries[0])
        self.assertIn('has_any_column_privilege(role_name,c.oid', self.queries[0])
        self.assertIn('aclexplode(col.attacl)', self.queries[0])
        self.assertIn('not col.attisdropped and a.grantee<>c.relowner', self.queries[0])
        self.assertNotIn('PRIVATE OWNER ACL', json.dumps(proof))

    def test_every_install_gate_is_required_and_strictly_boolean(self):
        for key in self.checks:
            for invalid in ([False, 1] if key != 'manifest_rows' else [True, 0, 2]):
                self.queries = []
                original = self.checks[key]
                self.checks[key] = invalid
                with self.assertRaises(AssertionError, msg=key):
                    self.verify()
                self.checks[key] = original

    def test_original_source_and_ledger_and_writer_bytes_must_survive(self):
        for mutate in [lambda v: v['relations']['auth.users'].update(hash='d' * 64),
                       lambda v: v['writers'].update({'public.writer0()': 'd' * 64}),
                       lambda v: v['ledger'][0].update(version='changed')]:
            original = copy.deepcopy(self.installed)
            mutate(self.installed)
            self.queries = []
            with self.assertRaises(AssertionError):
                self.verify()
            self.installed = original

    def test_unexpected_new_relation_and_missing_manifest_rejected(self):
        for action in ['new', 'missing']:
            original = copy.deepcopy(self.installed)
            if action == 'new':
                self.installed['relations']['public.unreviewed'] = {'count': 0, 'hash': 'a' * 64}
            else:
                self.installed['engine_catalog']['functions'] = []
            self.queries = []
            with self.assertRaises(AssertionError):
                self.verify()
            self.installed = original

    def test_wrong_reviewed_writer_pin_rejected_before_sql(self):
        self.expected['canonical_writer_definition_hashes'] = {}
        with self.assertRaises(AssertionError):
            self.verify()
        self.assertEqual(self.queries, [])

    def test_public_installed_proof_rejects_missing_or_untyped_flags(self):
        proof = self.verify()
        for key in ('live_manifest_matches', 'canonical_writers', 'hosted_writes', 'passed'):
            bad = copy.deepcopy(proof)
            bad[key] = 1 if isinstance(proof[key], bool) else True
            with self.assertRaises(AssertionError):
                m.validate_installed_proof(bad)
        del proof['raw_rpcs_and_tables_private']
        with self.assertRaises(AssertionError):
            m.validate_installed_proof(proof)


if __name__ == '__main__':
    unittest.main()
