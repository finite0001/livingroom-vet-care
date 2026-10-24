"""Pure negative callback tests for local CLI/ledger atomicity acceptance."""
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import sys
import unittest

SOURCE = Path(__file__).resolve().parents[2] / 'tests/controlled-drugs/engine/candidate'
sys.path.insert(0, str(SOURCE))
SPEC = importlib.util.spec_from_file_location('cli_atomicity', SOURCE / 'cli_atomicity.py')
m = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(m)
BODY = (SOURCE.parent / 'release/controlled-stock-cli-body.sql').read_text()
from cli_migration_body import split_reviewed_statements
STATEMENTS = split_reviewed_statements(BODY)
VERSION = '20261020090000'
PRIOR = 'create function pg_temp.controlled_stock_prior_snapshot()returns jsonb language sql as $$select null::jsonb$$;'


def baseline():
    return {'relations': {n: {'count': 0, 'hash': 'a' * 64} for n in ('public.original', 'auth.users', 'storage.objects', 'extensions.fixture')},
            'prior': {'private': 'ORIGINAL CATALOG OWNER ACL'},
            'writers': {'public.writer' + str(i) + '()': 'b' * 64 for i in range(10)},
            'ledger': [{'version': f'{i:014d}', 'name': 'original', 'statements': ['select 1']} for i in range(204)],
            'engine_catalog': {'relations': [], 'functions': [], 'triggers': []},
            'catalog': {'schemas': {'public': {'owner': 1}, 'auth': {'owner': 1}, 'storage': {'owner': 1}, 'extensions': {'owner': 1}, 'supabase_migrations': {'owner': 1}},
                        'functions': {'public.original()': 'PRIVATE FUNCTION', 'supabase_migrations.original()': 'PRIVATE LEDGER FUNCTION'},
                        'relations': {'public.original': {'column_acl': None}, 'supabase_migrations.schema_migrations': {'trigger': None}}}}


class Callbacks:
    def __init__(self):
        self.before = baseline()
        self.current = copy.deepcopy(self.before)
        self.current['prior'] = None
        self.expected = {'kind': 'controlled-stock-release-expected-204-v2',
                         'expected_technical_manifest': {'version': 2, 'functions': {str(i): {} for i in range(171)}, 'relations': {str(i): {} for i in range(51)}},
                         'canonical_writer_definition_hashes': self.before['writers']}
        self.calls = []
        self.result_mutator = None
        self.state_mutator = None
        self.checks_pass = True
        self.queries = []

    def sql(self, query):
        self.queries.append(query)
        if query.startswith('begin;create schema '):
            self.current['catalog']['schemas'][m.FIXTURE] = {'owner': 1}
            self.current['catalog']['functions'][m.FIXTURE + '.guard()'] = 'PRIVATE FIXTURE'
            self.current['catalog']['relations']['supabase_migrations.schema_migrations']['trigger'] = m.TRIGGER
            return ''
        if query == m.DROP_SQL:
            self.current['catalog']['schemas'].pop(m.FIXTURE)
            self.current['catalog']['functions'].pop(m.FIXTURE + '.guard()')
            self.current['catalog']['relations']['supabase_migrations.schema_migrations']['trigger'] = None
            return ''
        if 'select jsonb_build_object(\'passed\'' in query:
            return json.dumps({'passed': self.checks_pass})
        result = copy.deepcopy(self.current)
        if 'pg_temp.controlled_stock_prior_snapshot()' in query:
            result['prior'] = self.before['prior']
        return json.dumps(result)

    def run(self, case, body):
        self.calls.append((case, body))
        if case == 'clean205':
            for i in range(21):
                self.current['relations']['public.controlled_stock_' + str(i)] = {'count': int(i == 0), 'hash': 'c' * 64}
            self.current['engine_catalog'] = {'relations': ['installed'], 'functions': ['installed'], 'triggers': ['installed']}
            self.current['ledger'].append({'version': VERSION, 'name': 'controlled_stock_cli_atomicity', 'statements': copy.deepcopy(STATEMENTS)})
        if self.state_mutator:
            self.state_mutator(case, self.current)
        message = m.LATE_MESSAGE if case == 'late_body' else m.LEDGER_MESSAGE
        process = subprocess.CompletedProcess([], int(case in ('late_body', 'ledgerfault')),
                                              json.dumps({'_tag': 'Error', 'error': {'code': 'MigrationApplyError', 'message': f'ERROR: {message} (SQLSTATE P0001)\nAt statement:94\nPRIVATE SQL CONTEXT'}}) if case in ('late_body', 'ledgerfault') else '',
                                              'Connecting to local database...\n')
        value = {'result': process, 'barrier_observation': {k: True for k in m.OBSERVER_FLAGS} if case in ('ledgerfault', 'clean205') else None}
        if self.result_mutator:
            self.result_mutator(case, value)
        return value

    def rehearse(self, body=BODY):
        return m.rehearse(self.sql, self.run, body, self.expected, self.before, migration_version=VERSION, expected_statements=STATEMENTS)


class CLIAtomicityTests(unittest.TestCase):
    def test_exact_body_is_required_and_outer_transaction_is_rejected(self):
        self.assertEqual(m.migration_body(BODY), BODY)
        for changed in ('begin;\n' + BODY + 'commit;\n', BODY + '\n', BODY.replace('90271040', '90271042', 1)):
            with self.assertRaises(AssertionError):
                m.migration_body(changed)

    def test_capture_trusted_empty_204(self):
        c = Callbacks()
        self.assertEqual(m.capture_baseline(c.sql, PRIOR, {'definition': c.before['prior']}), c.before)
        with self.assertRaises(AssertionError):
            m.capture_baseline(c.sql, PRIOR, {'definition': {}})

    def test_extensions_schema_without_tables_is_valid_but_missing_schema_is_not(self):
        c = Callbacks()
        del c.before['relations']['extensions.fixture']
        del c.current['relations']['extensions.fixture']
        self.assertEqual(m.capture_baseline(c.sql, PRIOR, {'definition': c.before['prior']}), c.before)
        self.assertTrue(c.rehearse()['passed'])
        del c.current['catalog']['schemas']['extensions']
        with self.assertRaises(AssertionError):
            m.capture_baseline(c.sql, PRIOR, {'definition': c.before['prior']})

    def test_preexisting_fixture_or_engine_is_rejected(self):
        for field in ('fixture', 'engine'):
            c = Callbacks()
            if field == 'fixture':
                c.current['catalog']['schemas'][m.FIXTURE] = {}
            else:
                c.current['engine_catalog']['functions'] = ['partial']
            with self.assertRaises(AssertionError):
                m.capture_baseline(c.sql, PRIOR, {'definition': c.before['prior']})

    def test_four_real_cli_callbacks_and_clean_bytes_and_sanitized_proof(self):
        c = Callbacks()
        proof = c.rehearse()
        self.assertEqual([x[0] for x in c.calls], list(m.CASES))
        self.assertTrue(all(body == BODY for _, body in c.calls[1:]))
        self.assertIn(m.LATE_MESSAGE, c.calls[0][1])
        self.assertNotIn(m.FIXTURE, c.calls[0][1])
        self.assertIn('pg_temp.cli_atomicity_installed_checks()is distinct from true', c.calls[0][1])
        self.assertIn("mode='ExclusiveLock'", c.calls[0][1])
        self.assertLess(c.calls[0][1].index('CLI fixture late body stage missing'), c.calls[0][1].index(m.LATE_MESSAGE))
        self.assertEqual(proof['clean_install_migration_count'], 205)
        self.assertEqual(proof['failure_count'], 2)
        for private in ('PRIVATE', 'column_acl', VERSION, 'actual parsed statement'):
            self.assertNotIn(private, json.dumps(proof))

    def test_missing_notice_is_accepted_but_exact_fixed_error_required(self):
        # Pinned CLI suppresses NOTICE: do not invent or require its forwarding.
        self.assertTrue(Callbacks().rehearse()['passed'])
        for text in ('ERROR: unrelated (SQLSTATE P0001)\n', f'ERROR: {m.LEDGER_MESSAGE} (SQLSTATE P0003)\n', f'echo ERROR: {m.LEDGER_MESSAGE} (SQLSTATE P0001)\n'):
            c = Callbacks()
            c.result_mutator = lambda case, value: setattr(value['result'], 'stdout', text) if case == 'ledgerfault' else None
            with self.assertRaises(AssertionError):
                c.rehearse()

    def test_structured_error_rejects_wrong_tag_code_state_and_context_only(self):
        good = {'_tag': 'Error', 'error': {'code': 'MigrationApplyError', 'message': f'ERROR: {m.LEDGER_MESSAGE} (SQLSTATE P0001)\nAt statement:99'}}
        variants = []
        for key, replacement in (('_tag', 'Success'), ('error', {'code': 'UnexpectedError', 'message': good['error']['message']})):
            bad = copy.deepcopy(good)
            bad[key] = replacement
            variants.append(bad)
        for primary in ('ERROR: unrelated (SQLSTATE P0001)', f'ERROR: {m.LEDGER_MESSAGE} (SQLSTATE P0003)', 'At statement:99'):
            bad = copy.deepcopy(good)
            bad['error']['message'] = primary + '\nCONTEXT SQL\n' + good['error']['message']
            variants.append(bad)
        for bad in variants:
            with self.subTest(bad=bad):
                process = subprocess.CompletedProcess([], 1, json.dumps(bad), '')
                with self.assertRaises(AssertionError):
                    m._failure(process, 'ledgerfault')

    def test_duplicate_envelopes_and_duplicate_json_keys_are_rejected(self):
        good = json.dumps({'_tag': 'Error', 'error': {'code': 'MigrationApplyError', 'message': f'ERROR: {m.LEDGER_MESSAGE} (SQLSTATE P0001)'}})
        for bad in (good + '\n' + good, good.replace('"_tag": "Error"', '"_tag":"Error","_tag":"Error"'), good.replace('"code": "MigrationApplyError"', '"code":"MigrationApplyError","code":"MigrationApplyError"')):
            with self.assertRaises(AssertionError):
                m._failure(subprocess.CompletedProcess([], 1, bad, ''), 'ledgerfault')
        with self.assertRaises(AssertionError):
            m._failure(subprocess.CompletedProcess([], 1, good, good), 'ledgerfault')

    def test_observed_actual_json_primary_error_accepts_without_forwarded_notice(self):
        message = f'ERROR: {m.LATE_MESSAGE} (SQLSTATE P0001)\nAt statement: 94\ndo $$begin raise exception PRIVATE;end$$'
        result = subprocess.CompletedProcess([], 1, json.dumps({'_tag': 'Error', 'error': {'code': 'MigrationApplyError', 'message': message}}) + '\n', 'Connecting to local database...\nApplying migration...\n')
        m._failure(result, 'late_body')

    def test_success_cannot_stand_in_for_refusal(self):
        c = Callbacks()
        c.result_mutator = lambda case, value: setattr(value['result'], 'returncode', 0) if case == 'late_body' else None
        with self.assertRaises(AssertionError):
            c.rehearse()

    def test_both_ledger_cases_require_actual_independent_observer(self):
        for target in ('ledgerfault', 'clean205'):
            for broken in (None, {}, {k: 1 for k in m.OBSERVER_FLAGS}, {k: k != 'observer_closed' for k in m.OBSERVER_FLAGS}):
                c = Callbacks()
                c.result_mutator = lambda case, value: value.update(barrier_observation=broken) if case == target else None
                with self.assertRaises(AssertionError):
                    c.rehearse()

    def test_unexpected_observer_or_output_key_is_rejected(self):
        for mode in ('extra', 'observer'):
            c = Callbacks()
            def mutate(case, value):
                if case == 'late_body':
                    value['unexpected' if mode == 'extra' else 'barrier_observation'] = True
            c.result_mutator = mutate
            with self.assertRaises(AssertionError):
                c.rehearse()

    def test_every_failed_relation_ledger_catalog_and_writer_change_rejects(self):
        for field in ('relations', 'ledger', 'catalog', 'writers'):
            c = Callbacks()
            def mutate(case, current):
                if case != 'ledgerfault':
                    return
                if field == 'ledger':
                    current[field][0]['name'] = 'changed'
                elif field == 'catalog':
                    current[field]['relations']['public.original']['column_acl'] = ['grant']
                elif field == 'relations':
                    current[field]['public.original']['count'] = 1
                else:
                    current[field]['public.writer0()'] = 'f' * 64
            c.state_mutator = mutate
            with self.assertRaises(AssertionError):
                c.rehearse()
            self.assertNotIn(m.FIXTURE, c.current['catalog']['schemas'])

    def test_install_sql_checks_cannot_be_skipped(self):
        c = Callbacks()
        c.checks_pass = False
        with self.assertRaises(AssertionError):
            c.rehearse()

    def test_clean_cli_failure_is_not_acceptance(self):
        c = Callbacks()
        c.result_mutator = lambda case, value: setattr(value['result'], 'returncode', 1) if case == 'clean205' else None
        with self.assertRaises(AssertionError):
            c.rehearse()
        self.assertNotIn(m.FIXTURE, c.current['catalog']['schemas'])

    def test_exact_ledger_new_row_and_original_rows_are_checked(self):
        for fault in ('name', 'version', 'statements', 'wrongstatement', 'oldrow'):
            c = Callbacks()
            def mutate(case, current):
                if case == 'clean205':
                    if fault == 'oldrow':
                        current['ledger'][0]['name'] = 'changed'
                    elif fault == 'wrongstatement':
                        current['ledger'][-1]['statements'][0] = 'select 12345'
                    else:
                        current['ledger'][-1][fault] = [] if fault == 'statements' else 'wrong'
            c.state_mutator = mutate
            with self.assertRaises(AssertionError):
                c.rehearse()

    def test_original_source_and_ledger_catalog_survive_success(self):
        for fault in ('source', 'ledger_catalog', 'ledger_function', 'schema'):
            c = Callbacks()
            def mutate(case, current):
                if case != 'clean205':
                    return
                if fault == 'source':
                    current['relations']['public.original']['count'] = 1
                elif fault == 'ledger_catalog':
                    current['catalog']['relations']['supabase_migrations.schema_migrations']['column_acl'] = ['grant']
                elif fault == 'ledger_function':
                    current['catalog']['functions']['supabase_migrations.original()'] = 'changed'
                else:
                    current['catalog']['schemas']['supabase_migrations']['owner'] = 2
            c.state_mutator = mutate
            with self.assertRaises(AssertionError):
                c.rehearse()

    def test_retry_requires_success_and_exact_full_snapshot(self):
        for fault in ('failure', 'change'):
            c = Callbacks()
            if fault == 'failure':
                c.result_mutator = lambda case, value: setattr(value['result'], 'returncode', 1) if case == 'clean205_retry' else None
            else:
                c.state_mutator = lambda case, current: current['relations']['public.original'].update(count=1) if case == 'clean205_retry' else None
            with self.assertRaises(AssertionError):
                c.rehearse()

    def test_final_proof_strict_types_missing_flags_extra_private_keys(self):
        proof = Callbacks().rehearse()
        for key, replacement in (('failure_count', True), ('same_backend_engine_barrier_at_ledger_insert', 1), ('ledger_record_sha256', 'bad'), ('clinical_or_register_activation', True)):
            broken = copy.deepcopy(proof)
            broken[key] = replacement
            with self.assertRaises(AssertionError):
                m.validate_proof(broken)
        for key in proof:
            broken = copy.deepcopy(proof)
            del broken[key]
            with self.assertRaises(AssertionError):
                m.validate_proof(broken)
        with self.assertRaises(AssertionError):
            m.validate_proof(dict(proof, private_catalog={}))

    def test_cleanup_failure_preserves_primary_and_cannot_publish_success(self):
        def broken_sql(query):
            raise RuntimeError('cleanup failed')
        primary = AssertionError('original stage failure')
        m._drop_fixture(broken_sql, primary)
        self.assertIn('RuntimeError', primary.__notes__[0])
        with self.assertRaisesRegex(RuntimeError, 'cleanup failed'):
            m._drop_fixture(broken_sql)

    def test_caller_cannot_adopt_a_different_expected_statement_array(self):
        c = Callbacks()
        with self.assertRaises(AssertionError):
            m.rehearse(c.sql, c.run, BODY, c.expected, c.before,
                       migration_version=VERSION, expected_statements=['select 12345'])
        self.assertEqual(c.calls, [])

    def test_guard_order_and_gate_are_inside_actual_ledger_trigger(self):
        sql = m._scaffold_sql('ledgerfault', VERSION, Callbacks().expected)
        self.assertLess(sql.index('if controlled_cli_atomicity_fixture.installed_checks()is distinct from true'), sql.index('perform pg_advisory_xact_lock(90271041,0)'))
        self.assertLess(sql.index("mode='ExclusiveLock'"), sql.index('perform pg_advisory_xact_lock(90271041,0)'))
        self.assertLess(sql.index('perform pg_advisory_xact_lock(90271041,0)'), sql.index(m.LEDGER_MESSAGE))
        self.assertIn("objsubid=2", sql)
        self.assertIn('before insert on supabase_migrations.schema_migrations', sql)
        self.assertIn("return families=21", sql)
        self.assertTrue(sql.startswith('begin;'))
        self.assertTrue(sql.endswith('commit;\n'))


if __name__ == '__main__':
    unittest.main()
