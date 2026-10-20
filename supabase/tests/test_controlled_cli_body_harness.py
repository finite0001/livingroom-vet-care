"""Offline trust, byte identity, and CLI transaction-ownership guards."""
import hashlib
import importlib.util
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tests/controlled-drugs/engine/candidate'
sys.path.insert(0, str(SOURCE))
SPEC = importlib.util.spec_from_file_location('cli_migration_body', SOURCE / 'cli_migration_body.py')
BODY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BODY)
import release_assembly as ASSEMBLY


class ControlledCliBodyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.source = cls.root / SOURCE.relative_to(ROOT)
        cls.source.mkdir(parents=True)
        inputs = ASSEMBLY.assembled_sources(SOURCE) + [SOURCE / ASSEMBLY.PIN_NAME,
            SOURCE / 'release-expected-204-v1.json', SOURCE / 'trusted-prior-189.json', SOURCE / 'prior-snapshot.sql']
        for path in inputs:
            target = cls.root / path.relative_to(ROOT)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, target)
        shutil.copytree(ROOT / 'supabase/migrations', cls.root / 'supabase/migrations')
        cls.release = cls.source.parent / 'release'
        cls.release.mkdir()
        cls.artifact = cls.release / 'controlled-stock-private.sql'
        cls.artifact.write_bytes((SOURCE.parent / 'release/controlled-stock-private.sql').read_bytes())
        from canonical_prefix import canonical_prefix
        cls.files = canonical_prefix(cls.source, sorted((cls.root / 'supabase/migrations').glob('*.sql')))
        cls.baseline = BODY.build_cli_body(cls.source, cls.files)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def test_repeat_identity_and_reversible_outer_strip(self):
        result = BODY.build_cli_body(self.source, self.files)
        self.assertEqual(result, self.baseline)
        raw = result['body'].encode()
        self.assertEqual(hashlib.sha256(raw).hexdigest(), BODY.BODY_SHA256)
        self.assertEqual(len(raw), 1173738)
        self.assertEqual(BODY.PREFIX + raw + BODY.SUFFIX, self.artifact.read_bytes())
        self.assertEqual(result['statement_count'], 94)
        self.assertEqual(result['lexical_statement_count'], 93)
        self.assertEqual(result['expected_statements'][-1], '-- CONTROLLED_RELEASE_BEFORE_COMMIT --')
        import json
        self.assertEqual(hashlib.sha256(json.dumps(result['expected_statements'],sort_keys=True,separators=(',', ':')).encode()).hexdigest(), BODY.STATEMENT_ARRAY_SHA256)
        self.assertIn('tests/controlled-drugs/engine/release/controlled-stock-private.sql', result['input_source_hashes'])
        self.assertTrue(result['body'].startswith('select pg_advisory_xact_lock(90271040,0);\n'))
        self.assertIn('-- CONTROLLED_RELEASE_BEFORE_COMMIT --', result['body'])

    def test_parent_artifact_mutations_fail_without_resealing(self):
        original = self.artifact.read_bytes()
        for data in [original[7:], original[:-8], b'BEGIN;\n' + original[7:],
                     original + b'\n', original.replace(b'select pg_advisory_xact_lock', b'select pg_advisory_xact_locK', 1),
                     original[:100] + original[101:], original[7:100] + original[:7] + original[100:]]:
            try:
                self.artifact.write_bytes(data)
                with self.subTest(length=len(data)), self.assertRaises(AssertionError):
                    BODY.build_cli_body(self.source, self.files)
            finally:
                self.artifact.write_bytes(original)

    def test_parent_pin_and_source_mutations_are_rejected(self):
        for path in [self.source / ASSEMBLY.PIN_NAME, self.source / 'seal.sql', self.files[-1]]:
            original = path.read_bytes()
            try:
                path.write_bytes(original + b'\n')
                with self.subTest(path=path.name), self.assertRaises(AssertionError):
                    BODY.build_cli_body(self.source, self.files)
            finally:
                path.write_bytes(original)
        with self.assertRaisesRegex(AssertionError, 'expected pin changed'):
            BODY.derive_cli_body(self.artifact.read_bytes(), '0' * 64)

    def test_checked_body_tamper_cannot_pass(self):
        path = self.release / 'body.sql'
        path.write_text(self.baseline['body'])
        BODY.check_cli_body(self.source, self.files, path)
        for value in [self.baseline['body'] + 'select 1;\n', self.baseline['body'][1:],
                      BODY.PREFIX.decode() + self.baseline['body'] + BODY.SUFFIX.decode()]:
            path.write_text(value)
            with self.assertRaisesRegex(AssertionError, 'Frozen CLI body differs'):
                BODY.check_cli_body(self.source, self.files, path)

    def test_literals_function_bodies_and_nested_comments_do_not_hide_boundaries(self):
        sql = """-- COMMIT;
/* BEGIN; /* nested */ ROLLBACK; */
select 'COMMIT; it''s literal', "BEGIN", E'escaped\\\'; COMMIT;';
do $tag$ begin perform 'commit;'; end $tag$;
create function x() returns void language plpgsql as $$begin null; end$$;
"""
        self.assertEqual(BODY.audit_cli_statements(sql), 3)
        self.assertEqual(BODY.audit_cli_statements("select '-- pg-delta: transaction=false';"), 1)

    def test_authored_transaction_controls_are_refused(self):
        for sql in ['begin;', 'COMMIT;', 'end;', 'abort;', 'rollback to savepoint x;',
                    'start /* comment */ transaction;', 'prepare transaction \'x\';',
                    'savepoint x;', 'release savepoint x;', "select 'ok';\n-- harmless\ncommit;"]:
            with self.subTest(sql=sql), self.assertRaises(AssertionError):
                BODY.audit_cli_statements(sql)

    def test_pipeline_incompatible_and_nontransactional_directives_are_refused(self):
        for sql in ['vacuum;', 'cluster x;', 'alter system set x=1;',
                    'create unique index concurrently x on y(z);', 'drop index concurrently x;',
                    'reindex index concurrently x;', '-- pg-delta: transaction=false\nselect 1;',
                    '/* pg-delta: transaction = FALSE */ select 1;', 'copy x to stdout;']:
            with self.subTest(sql=sql), self.assertRaises(AssertionError):
                BODY.audit_cli_statements(sql)

    def test_malformed_quoted_or_unterminated_input_is_refused(self):
        for sql in ["select 'unterminated;", 'select "unterminated;', 'do $x$ begin null; end;',
                    'select 1; /* unclosed', "'commit';", '"COMMIT";', 'select 1; \'extra\'',
                    'select 1', '\ufeffselect 1;', 'select 1;\x00', '', '-- nothing']:
            with self.subTest(sql=sql), self.assertRaises(AssertionError):
                BODY.audit_cli_statements(sql)

    def test_fixed_ledger_array_rejects_wrong_order_body_and_comment_tail(self):
        import json
        original = self.baseline['expected_statements']
        mutations = [original[:-1], list(reversed(original)), ['select 1'] + original[1:],
                     original[:-1] + ['-- wrong retained comment']]
        for values in mutations:
            with self.subTest(length=len(values)):
                self.assertNotEqual(hashlib.sha256(json.dumps(values,sort_keys=True,separators=(',', ':')).encode()).hexdigest(), BODY.STATEMENT_ARRAY_SHA256)
        self.assertEqual(BODY.split_reviewed_statements("-- leading\nselect 'a;b';\n-- trailing"),
                         ["-- leading\nselect 'a;b'", '-- trailing'])

    def test_cli_check_is_pure_and_binds_checked_in_output(self):
        result = subprocess.run([sys.executable, '-B', str(SOURCE / 'cli_migration_body.py'), '--check'],
                                capture_output=True, text=True, check=True)
        import json
        proof = json.loads(result.stdout)
        self.assertEqual(proof['body_sha256'], BODY.BODY_SHA256)
        self.assertEqual(proof['database_operations'], 0)
        self.assertEqual(proof['hosted_writes'], 0)


if __name__ == '__main__':
    unittest.main()
