"""Pure callback tests for actual pre204 to canonical205 verification."""
import copy
import json
from pathlib import Path
import sys
import unittest

SOURCE = Path(__file__).resolve().parents[2] / 'tests/controlled-drugs/engine/candidate'
sys.path.insert(0, str(SOURCE))
import canonical_post205 as m
from canonical_prefix import canonical_binding

BINDING = canonical_binding(SOURCE, sorted((SOURCE.parents[3] / 'supabase/migrations').glob('*.sql')))
PRIOR = 'create function pg_temp.controlled_stock_prior_snapshot()returns jsonb language sql as $$select null::jsonb$$;'


def baseline():
    return {'relations': {n: {'count': 0, 'hash': 'a' * 64} for n in ('public.original', 'auth.users', 'storage.objects')},
            'prior': {'private': 'PRIVATE ORIGINAL PRIOR'},
            'writers': {'public.writer' + str(i) + '()': 'b' * 64 for i in range(10)},
            'ledger': [{'version': f'{i:014d}', 'name': 'original', 'statements': ['private original statement']} for i in range(204)],
            'engine_catalog': {'relations': [], 'functions': [], 'triggers': []},
            'catalog': {'schemas': {n: {'owner': 1} for n in ('public', 'auth', 'storage', 'extensions', 'supabase_migrations')},
                        'functions': {'public.original()': 'PRIVATE FUNCTION', 'supabase_migrations.original()': 'PRIVATE LEDGER FUNCTION'},
                        'relations': {'public.original': {'column_acl': None}, 'supabase_migrations.schema_migrations': {'trigger': None}}}}


class Callbacks:
    def __init__(self):
        self.before = baseline()
        self.installed = copy.deepcopy(self.before)
        self.installed['prior'] = None
        self.installed['ledger'].append({'version': BINDING['version'], 'name': BINDING['name'], 'statements': BINDING['expected_statements']})
        for i in range(21):
            self.installed['relations']['public.controlled_stock_' + str(i)] = {'count': int(i == 0), 'hash': 'c' * 64}
        self.installed['engine_catalog'] = {'relations': ['installed'], 'functions': ['installed'], 'triggers': ['installed']}
        self.expected = {'kind': 'controlled-stock-release-expected-204-v2',
                         'expected_technical_manifest': {'version': 2, 'functions': {str(i): {} for i in range(171)}, 'relations': {str(i): {} for i in range(51)}},
                         'canonical_writer_definition_hashes': self.before['writers']}
        self.checks = True
        self.queries = []

    def sql(self, query):
        self.queries.append(query)
        if "select jsonb_build_object('passed'" in query:
            return json.dumps({'passed': self.checks})
        return json.dumps(self.installed)

    def capture(self, phase='ordinary'):
        return m.capture_pre204(lambda query: json.dumps(self.before), PRIOR, {'definition': self.before['prior']}, phase=phase)

    def verify(self):
        return m.verify_canonical_installed(self.sql, self.expected, self.before, BINDING)


class CanonicalPost205Tests(unittest.TestCase):
    def test_real_pre204_capture_ordinary_and_historical(self):
        c = Callbacks()
        self.assertEqual(c.capture(), c.before)
        c.before['relations']['auth.users']['count'] = 1
        self.assertEqual(c.capture('historical'), c.before)
        with self.assertRaises(AssertionError):
            c.capture('ordinary')

    def test_capture_refuses_prior_drift_existing_engine_and_missing_schema(self):
        for fault in ('prior', 'engine', 'schema', 'ledger'):
            c = Callbacks()
            if fault == 'prior':
                with self.assertRaises(AssertionError):
                    m.capture_pre204(lambda q: json.dumps(c.before), PRIOR, {'definition': {}}, phase='historical')
                continue
            if fault == 'engine':
                c.before['engine_catalog']['functions'] = ['existing']
            elif fault == 'schema':
                del c.before['catalog']['schemas']['extensions']
            else:
                c.before['ledger'].append(copy.deepcopy(c.before['ledger'][-1]))
            with self.assertRaises(AssertionError):
                c.capture('historical')

    def test_exact_install_proof_and_sanitized_output_without_install_sql(self):
        c = Callbacks()
        proof = c.verify()
        self.assertTrue(proof['passed'])
        self.assertEqual(proof['installed_migration_count'], 205)
        self.assertFalse(proof['private_artifact_reinstalled'])
        self.assertTrue(all('insert into' not in q.lower() and 'create table' not in q.lower() for q in c.queries))
        for private in ('PRIVATE', BINDING['version'], 'private original statement', BINDING['canonical_path']):
            self.assertNotIn(private, json.dumps(proof))

    def test_none_or_postinstall_baseline_is_not_accepted(self):
        c = Callbacks()
        for wrong in (None, {}, c.installed):
            with self.assertRaises(AssertionError):
                m.verify_canonical_installed(c.sql, c.expected, wrong, BINDING)

    def test_installed_boolean_gate_is_strict(self):
        for value in (False, 1, None):
            c = Callbacks()
            c.checks = value
            with self.assertRaises(AssertionError):
                c.verify()

    def test_exact_205_record_rejects_wrong_name_version_or_statement(self):
        for field in ('name', 'version', 'statements'):
            c = Callbacks()
            c.installed['ledger'][-1][field] = ['select 12345'] if field == 'statements' else 'wrong'
            with self.assertRaises(AssertionError):
                c.verify()

    def test_original_204_ledger_rows_cannot_be_normalized_or_replaced(self):
        c = Callbacks()
        c.installed['ledger'][0]['name'] = 'changed'
        with self.assertRaises(AssertionError):
            c.verify()
        c = Callbacks()
        c.installed['ledger'] = c.installed['ledger'][1:]
        with self.assertRaises(AssertionError):
            c.verify()

    def test_arbitrary_binding_count_path_name_version_or_array_rejected(self):
        c = Callbacks()
        for field, wrong in (('canonical_migration_count', True), ('version', '20261020090000'), ('name', 'wrong'), ('canonical_path', '/private/path'), ('expected_statements', ['select 1'])):
            binding = copy.deepcopy(BINDING)
            binding[field] = wrong
            with self.assertRaises(AssertionError):
                m.verify_canonical_installed(c.sql, c.expected, c.before, binding)
        self.assertEqual(c.queries, [])

    def test_original_source_writers_and_ledger_catalog_are_preserved(self):
        for fault in ('source', 'writer', 'ledger_relation', 'ledger_function', 'namespace'):
            c = Callbacks()
            if fault == 'source':
                c.installed['relations']['public.original']['hash'] = 'f' * 64
            elif fault == 'writer':
                c.installed['writers']['public.writer0()'] = 'f' * 64
            elif fault == 'ledger_relation':
                c.installed['catalog']['relations']['supabase_migrations.schema_migrations']['column_acl'] = ['grant']
            elif fault == 'ledger_function':
                c.installed['catalog']['functions']['supabase_migrations.original()'] = 'changed'
            else:
                c.installed['catalog']['schemas']['public']['owner'] = 2
            with self.assertRaises(AssertionError):
                c.verify()

    def test_unexpected_tables_or_leftover_fixture_are_rejected(self):
        for fault in ('table', 'fixture'):
            c = Callbacks()
            if fault == 'table':
                c.installed['relations']['public.unexpected'] = {'count': 0, 'hash': 'd' * 64}
            else:
                c.installed['catalog']['schemas'][m.atomic.FIXTURE] = {'owner': 1}
            with self.assertRaises(AssertionError):
                c.verify()

    def test_public_proof_validator_rejects_missing_flags_and_coercion(self):
        proof = Callbacks().verify()
        for field, wrong in (('passed', 1), ('installed_migration_count', True), ('exact_canonical_205_ledger_verified', 1), ('private_artifact_reinstalled', True), ('body_sha256', 'a' * 64)):
            changed = copy.deepcopy(proof)
            changed[field] = wrong
            with self.assertRaises(AssertionError):
                m.validate_proof(changed)
        for field in proof:
            changed = copy.deepcopy(proof)
            del changed[field]
            with self.assertRaises(AssertionError):
                m.validate_proof(changed)
        with self.assertRaises(AssertionError):
            m.validate_proof(dict(proof, raw_ledger=[]))


if __name__ == '__main__':
    unittest.main()
