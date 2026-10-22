"""Pure negative contracts for current-canonical attachment scratch clones."""
import ast
import copy
import json
import re
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

SOURCE = Path(__file__).resolve().parent
sys.path.insert(0, str(SOURCE))
import owned_attachment_clone as m
PREFIX, BINDING, EXPECTED = m.reviewed_inputs()
FIXTURE = "insert into auth.users(id)values('db690000-0000-4000-8000-000000000001');"


def source_snapshot():
    ledger = [{'version': p.name.split('_', 1)[0], 'name': p.stem.split('_', 1)[1], 'statements': ['original real entry']} for p in PREFIX]
    ledger.append({'version': BINDING['version'], 'name': BINDING['name'], 'statements': BINDING['expected_statements']})
    return {'relations': {n: {'count': int(n.endswith('manifests')), 'hash': 'a' * 64} for n in ('public.controlled_stock_engine_manifests', 'auth.users', 'storage.objects')},
            'prior': None, 'writers': EXPECTED['canonical_writer_definition_hashes'], 'ledger': ledger,
            'engine_catalog': {'relations': ['installed'], 'functions': ['installed'], 'triggers': ['installed']},
            'catalog': {'schemas': {n: {'owner': 1} for n in ('public', 'auth', 'storage', 'extensions', 'supabase_migrations')},
                        'functions': {'public.original()': 'PRIVATE DEFINITION'}, 'relations': {'public.original': {'acl': 'PRIVATE ACL'}}}}


class Callbacks:
    def __init__(self):
        self.before = source_snapshot()
        self.after = copy.deepcopy(self.before)
        self.checks = True
        self.clean = True
        self.snapshots = 0
        self.queries = []

    def sql(self, query):
        self.queries.append(query)
        if "select jsonb_build_object('passed'" in query:
            return json.dumps({'passed': self.checks})
        if "select jsonb_build_object('fixture_clean'" in query:
            return json.dumps({'fixture_clean': self.clean})
        self.snapshots += 1
        return json.dumps(self.before if self.snapshots == 1 else self.after)

    def admit(self):
        return m.admit_source(self.sql, [FIXTURE])


class OwnedAttachmentCloneTests(unittest.TestCase):
    def test_source_and_clone_admission_preserve_real_ledger_and_private_pin(self):
        c = Callbacks()
        before = c.admit()
        self.assertEqual(before, c.before)
        c.snapshots = 0
        proof = m.verify_clone(c.sql, before)
        self.assertIs(proof['passed'], True)
        self.assertEqual(proof['canonical_migrations'], 205)
        self.assertFalse(proof['schema_rebuilt_or_migrations_manually_replayed'])
        self.assertNotIn('PRIVATE', json.dumps(proof))
        self.assertNotIn('db690000-', json.dumps(proof))
        self.assertTrue(any('controlled_stock_manifest_snapshot()' in q for q in c.queries))

    def test_independent_pin_failure_or_boolean_coercion_cannot_admit_source(self):
        for value in (False, 1, None):
            c = Callbacks()
            c.checks = value
            with self.assertRaises(AssertionError):
                c.admit()

    def test_wrong_or_missing_canonical_ledger_and_nonempty_wrong_statements_rejected(self):
        for fault in ('missing', 'version', 'name', 'statements', 'prefixversion', 'prefixname'):
            c = Callbacks()
            if fault == 'missing':
                c.before['ledger'].pop()
            elif fault.startswith('prefix'):
                c.before['ledger'][0][fault.removeprefix('prefix')] = 'wrong'
            else:
                c.before['ledger'][-1][fault] = ['select 12345'] if fault == 'statements' else 'wrong'
            c.after = copy.deepcopy(c.before)
            with self.assertRaises(AssertionError):
                c.admit()

    def test_conflicting_fixture_source_is_refused_without_clearing(self):
        for value in (False, 1, None):
            c = Callbacks()
            c.clean = value
            with self.assertRaises(AssertionError):
                c.admit()
        c = Callbacks()
        c.admit()
        query = next(q for q in c.queries if "'fixture_clean'" in q)
        self.assertIn('from auth.users where id in', query)
        self.assertIn('from ezyvet_import_snapshots', query)
        self.assertIn('from public.ezyvet_attachment_capture_requests', query)
        self.assertNotIn('delete from', query.lower())
        self.assertNotIn('truncate ', query.lower())

    def test_each_conflicting_migration_family_is_refused_without_child_imports(self):
        class ExistingRows(Callbacks):
            def __init__(self, relation):
                super().__init__()
                self.relation = relation
                self.before['relations']['public.' + relation] = {'count': 1, 'hash': 'b' * 64}
                self.after = copy.deepcopy(self.before)

            def sql(self, query):
                if "select jsonb_build_object('fixture_clean'" in query:
                    self.queries.append(query)
                    # Mock the existence semantics of the actual emitted SQL.
                    # Removing any required predicate would incorrectly admit
                    # that populated family and make this negative test fail.
                    empty_checks = set(re.findall(r'not exists\(select 1 from (?:public\.)?([a-z_]+)\)', query))
                    return json.dumps({'fixture_clean': self.relation not in empty_checks})
                return super().sql(query)

        for relation in ('ezyvet_migration_runs', 'ezyvet_migration_scopes', 'ezyvet_migration_bindings'):
            with self.subTest(relation=relation):
                c = ExistingRows(relation)
                with self.assertRaisesRegex(AssertionError, 'conflicting attachment fixtures'):
                    c.admit()
                self.assertEqual(c.snapshots, 1, 'Refusal must precede clone use or post-admission snapshot')
                query = next(q for q in c.queries if "'fixture_clean'" in q)
                self.assertNotIn('delete from', query.lower())
                self.assertNotIn('truncate ', query.lower())

    def test_unrelated_clinical_documents_and_receipts_remain_allowed_and_preserved(self):
        c = Callbacks()
        for relation in ('patient_documents', 'external_record_receipts'):
            c.before['relations']['public.' + relation] = {'count': 2, 'hash': 'c' * 64}
        c.after = copy.deepcopy(c.before)
        admitted = c.admit()
        self.assertEqual(admitted, c.before)
        clean_query = next(q for q in c.queries if "'fixture_clean'" in q)
        self.assertNotIn('from patient_documents', clean_query)
        self.assertNotIn('from public.patient_documents', clean_query)
        self.assertNotIn('from external_record_receipts', clean_query)
        self.assertNotIn('from public.external_record_receipts', clean_query)

    def test_missing_fixture_identity_contract_is_refused(self):
        c = Callbacks()
        for fixtures in ([], ['select 1;']):
            with self.assertRaises(AssertionError):
                m.admit_source(c.sql, fixtures)

    def test_changed_source_during_admission_is_not_adopted(self):
        c = Callbacks()
        c.after['relations']['auth.users']['count'] = 1
        with self.assertRaises(AssertionError):
            c.admit()

    def test_clone_must_pass_independent_pin_even_if_data_equal(self):
        c = Callbacks()
        c.checks = False
        with self.assertRaises(AssertionError):
            m.verify_clone(c.sql, c.before)

    def test_clone_rows_ledger_writers_and_engine_catalog_must_match_exactly(self):
        for fault in ('relations', 'ledger', 'writers', 'engine_catalog'):
            c = Callbacks()
            original = copy.deepcopy(c.before)
            if fault == 'relations':
                c.before['relations']['auth.users']['count'] = 1
            elif fault == 'ledger':
                c.before['ledger'][0]['statements'] = ['changed old record']
            elif fault == 'writers':
                c.before['writers'] = dict(c.before['writers'])
                c.before['writers'][next(iter(c.before['writers']))] = 'f' * 64
            else:
                c.before['engine_catalog']['triggers'] = ['changed']
            with self.assertRaises(AssertionError):
                m.verify_clone(c.sql, original)

    def test_source_catalog_or_data_changes_after_tests_are_rejected(self):
        for fault in ('catalog', 'data', 'ledger'):
            c = Callbacks()
            original = copy.deepcopy(c.before)
            if fault == 'catalog':
                c.before['catalog']['functions']['public.original()'] = 'changed'
            elif fault == 'data':
                c.before['relations']['auth.users']['hash'] = 'f' * 64
            else:
                c.before['ledger'][0]['name'] = 'changed'
            with self.assertRaises(AssertionError):
                m.verify_source_unchanged(c.sql, original)
        c = Callbacks()
        self.assertTrue(m.verify_source_unchanged(c.sql, c.before))

    def test_scheduler_receipt_mutation_is_refused_with_bounded_safe_diagnostics(self):
        c = Callbacks()
        original = copy.deepcopy(c.before)
        c.before['relations']['public.scheduler_job_runs'] = {'count': 1, 'hash': 'b' * 64}
        c.before['catalog']['functions']['public.original()'] = 'PRIVATE BODY'
        with self.assertRaises(AssertionError) as caught:
            m.verify_source_unchanged(c.sql, original)
        diagnostic = json.loads(str(caught.exception).split(': ', 1)[1])
        self.assertEqual(diagnostic['changed_components'], ['catalog', 'relations'])
        self.assertEqual(diagnostic['changed_relations'], ['public.scheduler_job_runs'])
        self.assertNotIn('PRIVATE', str(caught.exception))
        self.assertEqual(original, source_snapshot(), 'Expected source is never adopted or rewritten')
        c.snapshots = 0
        for number in range(25):
            c.before['relations']['public.synthetic_' + str(number)] = {'count': 1, 'hash': 'c' * 64}
        with self.assertRaises(AssertionError) as caught:
            m.verify_source_unchanged(c.sql, original)
        diagnostic = json.loads(str(caught.exception).split(': ', 1)[1])
        self.assertEqual(diagnostic['changed_relation_count'], 26)
        self.assertEqual(len(diagnostic['changed_relations']), 20)
        self.assertTrue(diagnostic['relations_truncated'])

    def test_both_entrypoints_use_full_verified_copy_without_drop_or_replay(self):
        for name in ('ezyvet_attachment_metadata_concurrency.py', 'ezyvet_attachment_originals_concurrency.py'):
            text = (SOURCE / name).read_text()
            ast.parse(text)
            self.assertNotIn('drop schema public', text.lower())
            self.assertNotIn("migration.read_text()", text)
            self.assertNotIn('--schema-only', text)
            self.assertNotIn('--no-owner', text)
            self.assertIn("'--schema=supabase_migrations'", text)
            self.assertIn("'--no-publications','--no-subscriptions'", text)
            self.assertIn('source_baseline=admit_source(', text)
            self.assertIn('clone_proof=verify_clone(', text)
            self.assertIn('verify_source_unchanged(', text)
            self.assertIn("restore_command[restore_command.index('-U')+1]='supabase_admin'", text)
            self.assertIn("args.project_config.resolve().parent.parent", text)
            self.assertIn('verify_clone_target()', text)
            self.assertIn("'ezyvet_attachment_metadata.test.sql'", text)


if __name__ == '__main__':
    unittest.main()
