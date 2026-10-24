"""Offline trust-boundary checks for source-derived private canonical206."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tests/controlled-drugs/engine/candidate'
sys.path.insert(0, str(SOURCE))
import secondary_review_ledger as ledger
import secondary_review_release as release
import secondary_review_cli_body as cli


class SecondaryReviewReleaseTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temporary.name)
        cls.source = cls.root / SOURCE.relative_to(ROOT)
        cls.source.mkdir(parents=True)
        # Copy explicit source dependencies only; no environment files or secrets.
        names = ['release-expected-204.json','secondary-review-acceptance.sql',
                 'secondary-review-protocol.sql','secondary-review-schema.sql',
                 'secondary_review_protocol_descriptor.py',release.PRIVATE_WRAPPER,
                 ledger.LEDGER_FILE,cli.STATEMENTS_FILE,'secondary_review_ledger.py',
                 'secondary_review_release.py','secondary_review_cli_body.py',
                 'cli_migration_body.py','release_assembly.py','local_install.py','derive_column_acl_pin.py']
        for name in names:
            shutil.copy2(SOURCE / name, cls.source / name)
        shutil.copytree(SOURCE / ledger.VENDOR, cls.source / ledger.VENDOR)
        shutil.copytree(ROOT / 'supabase/migrations', cls.root / 'supabase/migrations')
        (cls.source.parent / 'release').mkdir()
        for name in (release.ARTIFACT, cli.BODY_FILE):
            shutil.copy2(SOURCE.parent / 'release' / name, cls.source.parent / 'release' / name)
        cls.baseline = cli.check_cli_body(cls.source)

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def tamper(self, path, replacement, check):
        original = path.read_bytes()
        try:
            path.write_bytes(replacement)
            with self.assertRaises(AssertionError):
                check()
        finally:
            path.write_bytes(original)

    def test_deterministic_body_and_exact_wrapping(self):
        other = cli.check_cli_body(self.source)
        self.assertEqual(other, self.baseline)
        self.assertEqual(other['body_sha256'], cli.BODY_SHA256)
        self.assertEqual(cli.PREFIX + other['body'].encode() + cli.SUFFIX, other['install'].encode())
        self.assertEqual(len(other['expected_statements']), 304)
        self.assertEqual(other['lexical_statement_count'], 303)
        self.assertEqual(other['expected_statements'][0], 'select pg_advisory_xact_lock(90271040,0)')
        self.assertEqual(other['expected_statements'][-1], release.MARKERS['before_commit'])

    def test_all_old_migration_bytes_remain_bound(self):
        paths = ledger.source205(self.source)
        self.assertEqual(len(paths), 205)
        for path in (paths[0], paths[187], paths[203], paths[204]):
            with self.subTest(name=path.name):
                self.tamper(path, path.read_bytes() + b'\n', lambda: cli.check_cli_body(self.source))

    def test_missing_extra_and_noncanonical_names_refused(self):
        directory = self.root / 'supabase/migrations'
        path = ledger.source205(self.source)[0]
        original = path.read_bytes()
        path.unlink()
        try:
            with self.assertRaises(AssertionError):
                ledger.source205(self.source)
        finally:
            path.write_bytes(original)
        for name in ('20261023010000_extra.sql','wrong.sql','20261022010000_duplicate.sql'):
            extra = directory / name
            try:
                extra.write_text('select 1;\n')
                with self.assertRaises(AssertionError):
                    ledger.source205(self.source)
            finally:
                extra.unlink()

    def test_exact_new_body_cannot_be_substituted(self):
        for path in (self.root / 'supabase/migrations' / ledger.MIGRATION_206,
                     self.source.parent / 'release' / cli.BODY_FILE):
            original = path.read_bytes()
            for variant in (original + b'\n', b'begin;\n' + original + b'commit;\n', original[1:]):
                self.tamper(path, variant, lambda: cli.check_cli_body(self.source))

    def test_expected_metadata_sources_and_wrapper_refuse_drift(self):
        pin = json.loads((self.source / release.PRIVATE_WRAPPER).read_text())
        for name in (*pin['derivation_input_sha256'], release.PRIVATE_WRAPPER):
            with self.subTest(name=name):
                path = self.source / name
                self.tamper(path, path.read_bytes() + b'\n', lambda: release.package(self.source))

    def test_auth_profile_cannot_replace_private_expectation(self):
        auth = SOURCE / 'secondary_review_protocol_synthetic_auth_expected_v2.json'
        self.tamper(self.source / release.PRIVATE_WRAPPER, auth.read_bytes(), lambda: release.package(self.source))

    def test_every_ledger_row_is_complete_and_filename_bound(self):
        data = ledger.load_frozen(self.source)
        paths = ledger.source205(self.source)
        self.assertEqual(len(data['ledger']), 205)
        self.assertEqual(data['migration_sha256'], {p.name: ledger.sha(p.read_bytes()) for p in paths})
        for row, path in zip(data['ledger'], paths):
            self.assertEqual(row['version'] + '_' + row['name'] + '.sql', path.name)
            self.assertEqual(set(row), {'version','name','statements'})
        self.assertEqual(len(data['ledger'][-1]['statements']), 94)
        self.assertEqual(data['ledger'][-1]['statements'][-1], '-- CONTROLLED_RELEASE_BEFORE_COMMIT --')
        self.assertTrue(any(not s.isascii() for row in data['ledger'] for s in row['statements']))

    def test_frozen_ledger_refuses_statement_name_order_and_encoding_mutation(self):
        path = self.source / ledger.LEDGER_FILE
        data = json.loads(path.read_text())
        cases = []
        for mutate in (lambda d: d['ledger'].reverse(),
                       lambda d: d['ledger'][0].update(name='wrong'),
                       lambda d: d['ledger'][-1]['statements'].pop(),
                       lambda d: d['ledger'][0]['statements'].append('select 1')):
            changed = json.loads(path.read_text())
            mutate(changed)
            cases.append(json.dumps(changed,sort_keys=True,indent=2).encode())
        cases.append(json.dumps(data,sort_keys=True,ensure_ascii=False).encode())
        for encoded in cases:
            self.tamper(path, encoded, lambda: ledger.load_frozen(self.source))

    def test_official_provenance_and_statement_artifact_refuse_drift(self):
        names = ['provenance.json',*json.loads((self.source / ledger.VENDOR / 'provenance.json').read_text())['files']]
        for name in names:
            path = self.source / ledger.VENDOR / name
            self.tamper(path,path.read_bytes()+b'\n',lambda: ledger.provenance(self.source))
        path = self.source / cli.STATEMENTS_FILE
        self.tamper(path,path.read_bytes()+b'\n',lambda: cli.check_cli_body(self.source))

    def test_released_artifact_and_boundary_mutation_refused(self):
        path = self.source.parent / 'release' / release.ARTIFACT
        original = path.read_bytes()
        for variant in (original[7:], original[:-8], original+b'\n'):
            self.tamper(path,variant,lambda: cli.check_cli_body(self.source))

    def test_transaction_safety_audit_rejects_escaping_commands(self):
        for text in ('begin;','commit;','rollback;','vacuum;',
                     'create index concurrently x on y(z);','-- pg-delta: transaction=false\nselect 1;'):
            with self.subTest(sql=text), self.assertRaises(AssertionError):
                cli.audit_cli_statements(text)

    def test_cli_check_requires_no_database_or_typescript_runtime(self):
        result = subprocess.run([sys.executable,'-B',str(SOURCE / 'secondary_review_cli_body.py'),'--check'],
                                text=True,capture_output=True,check=True)
        report = json.loads(result.stdout)
        self.assertEqual(report['database_operations'], 0)
        self.assertEqual(report['hosted_writes'], 0)
        self.assertEqual(report['body_sha256'], cli.BODY_SHA256)

    def test_official_export_regenerates_frozen_source_expectations(self):
        path = Path(os.environ.get('CONTROLLED_REVIEW_TYPESCRIPT', str(ROOT / 'node_modules/typescript/lib/typescript.js')))
        if not path.is_file():
            self.skipTest('Optional source regeneration needs pinned TypeScript5.8.3; pure artifact checks still run')
        self.assertEqual(ledger.derive(path,self.source),ledger.load_frozen(self.source))
        result = cli.derive_statements(self.baseline['body'],path,self.source)
        self.assertEqual(result['statements'],self.baseline['expected_statements'])
        parsed = ledger.split_sources([dict(name='unicode-test',body="-- café\nselect 'é;猫';\n-- τέλος")],path,self.source)[0]
        self.assertEqual(parsed['statements'],["-- café\nselect 'é;猫'",'-- τέλος'])


if __name__ == '__main__':
    unittest.main()
