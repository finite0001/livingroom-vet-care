"""Canonical 205 inventory and retained independent 204 trust; no database calls."""
import copy
import hashlib
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tests/controlled-drugs/engine/candidate'
sys.path.insert(0, str(SOURCE))
import canonical_prefix as C
import cli_migration_body as B
import release_assembly as A
import canonical_review_prefix as R
import secondary_review_cli_body as REVIEW_BODY
import secondary_review_ledger as REVIEW_LEDGER


class ControlledCanonicalPrefixTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.source = cls.root / SOURCE.relative_to(ROOT)
        shutil.copytree(SOURCE, cls.source, ignore=shutil.ignore_patterns('__pycache__'))
        for name in ['source-reader.sql', 'source-effects.sql']:
            shutil.copy2(SOURCE.parent / name, cls.source.parent / name)
        shutil.copytree(SOURCE.parent / 'release', cls.source.parent / 'release')
        admitted205 = C.canonical205_files(SOURCE, sorted((ROOT / 'supabase/migrations').glob('*.sql')))
        (cls.root / 'supabase/migrations').mkdir(parents=True)
        for path in admitted205:
            shutil.copy2(path, cls.root / 'supabase/migrations' / path.name)
        cls.files = sorted((cls.root / 'supabase/migrations').glob('*.sql'))
        cls.binding = C.canonical_binding(cls.source, cls.files)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_exact_forward_port_preserves_independent_204_assembly(self):
        prefix = C.canonical_prefix(self.source, self.files)
        self.assertEqual(len(prefix), 204)
        self.assertEqual(A.build_release(self.source, prefix)['artifact_sha256'], B.ARTIFACT_SHA256)
        self.assertEqual(self.files[-1].read_bytes(), B.build_cli_body(self.source, prefix)['body'].encode())
        self.assertEqual(self.binding['filename'], C.CANONICAL_FILENAME)
        self.assertEqual(self.binding['version'], C.CANONICAL_VERSION)
        self.assertEqual(len(self.binding['expected_statements']), 94)
        self.assertEqual(C.validate_binding(copy.deepcopy(self.binding)), self.binding)

    def test_core_assembly_still_rejects_205(self):
        with self.assertRaises(AssertionError):
            A.build_release(self.source, self.files)
        with self.assertRaises(AssertionError):
            B.build_cli_body(self.source, self.files)

    def test_missing_duplicate_and_reordered_inventory_refused(self):
        for files in [self.files[:-1], self.files[1:], list(reversed(self.files)),
                      self.files[:-1] + [self.files[0]], self.files + [self.files[-1]]]:
            with self.subTest(count=len(files)), self.assertRaises(AssertionError):
                C.canonical_prefix(self.source, files)

    def test_extra_206_refused_even_when_caller_omits_it(self):
        extra = self.files[-1].parent / '20261020160000_unreviewed.sql'
        try:
            extra.write_text('select 1;\n')
            for files in [self.files, sorted(extra.parent.glob('*.sql'))]:
                with self.subTest(count=len(files)), self.assertRaises(AssertionError):
                    C.canonical_prefix(self.source, files)
        finally:
            extra.unlink()

    def test_renamed_forward_port_cannot_replace_canonical_identity(self):
        path = self.files[-1]
        renamed = path.with_name('20261020151158_controlled_stock_private_engine.sql')
        try:
            path.rename(renamed)
            with self.assertRaises(AssertionError):
                C.canonical_prefix(self.source, sorted(renamed.parent.glob('*.sql')))
        finally:
            renamed.rename(path)

    def test_modified_prefix_or_new_body_refused(self):
        for path in [self.files[0], self.files[203], self.files[204]]:
            original = path.read_bytes()
            try:
                path.write_bytes(original + b'\n-- changed\n')
                with self.subTest(path=path.name), self.assertRaises(AssertionError):
                    C.canonical_prefix(self.source, self.files)
            finally:
                path.write_bytes(original)

    def test_wrapping_body_or_dropping_internal_sql_refused(self):
        path = self.files[-1]
        original = path.read_bytes()
        for data in [B.PREFIX + original + B.SUFFIX, original[1:], original.replace(b'select pg_advisory_xact_lock(90271040,0);\n', b'', 1)]:
            try:
                path.write_bytes(data)
                with self.subTest(length=len(data)), self.assertRaises(AssertionError):
                    C.canonical_prefix(self.source, self.files)
            finally:
                path.write_bytes(original)

    def test_changed_independent_pin_cannot_adopt_prefix(self):
        path = self.source / 'release-expected-204.json'
        original = path.read_bytes()
        try:
            path.write_bytes(original + b'\n')
            with self.assertRaisesRegex(AssertionError, 'Independent 204 release pin changed'):
                C.canonical_prefix(self.source, self.files)
        finally:
            path.write_bytes(original)

    def test_foreign_directory_copy_is_not_canonical_inventory(self):
        with tempfile.TemporaryDirectory() as folder:
            foreign = Path(folder) / self.files[-1].name
            foreign.write_bytes(self.files[-1].read_bytes())
            with self.assertRaisesRegex(AssertionError, 'directory'):
                C.canonical_prefix(self.source, self.files[:-1] + [foreign])

    def test_binding_rejects_incorrect_identity_or_false_count(self):
        for key, bad in [('filename', 'other.sql'), ('version', '20261020151158'),
                         ('name', 'other'), ('canonical_path', '../other.sql'),
                         ('body_sha256', '0' * 64), ('statement_array_sha256', '0' * 64),
                         ('canonical_migration_count', True), ('canonical_migration_count', 204)]:
            value = copy.deepcopy(self.binding)
            value[key] = bad
            with self.subTest(key=key, bad=bad), self.assertRaises(AssertionError):
                C.validate_binding(value)

    def test_binding_rejects_missing_extra_and_mutated_ledger_array(self):
        values = []
        missing = copy.deepcopy(self.binding); del missing['filename']; values.append(missing)
        extra = copy.deepcopy(self.binding); extra['passed'] = True; values.append(extra)
        for statements in [self.binding['expected_statements'][:-1], list(reversed(self.binding['expected_statements'])),
                           ['select 1'] + self.binding['expected_statements'][1:], [True] * 94]:
            value = copy.deepcopy(self.binding); value['expected_statements'] = statements; values.append(value)
        for value in values:
            with self.subTest(keys=set(value)), self.assertRaises(AssertionError):
                C.validate_binding(value)


class ControlledCanonical206AdmissionTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.root = Path(cls.temp.name)
        cls.source = cls.root / SOURCE.relative_to(ROOT)
        shutil.copytree(SOURCE, cls.source, ignore=shutil.ignore_patterns('__pycache__'))
        for name in ['source-reader.sql','source-effects.sql']:
            shutil.copy2(SOURCE.parent / name, cls.source.parent / name)
        shutil.copytree(SOURCE.parent / 'release', cls.source.parent / 'release')
        shutil.copytree(ROOT / 'supabase/migrations', cls.root / 'supabase/migrations')
        cls.files = sorted((cls.root / 'supabase/migrations').glob('*.sql'))
        cls.admitted = R.admit_canonical206(cls.source,cls.files)

    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_exact206_admission_projects_original205_and204_only(self):
        self.assertEqual(len(self.admitted['prefix205']),205)
        self.assertEqual(len(self.admitted['prefix204']),204)
        self.assertEqual(C.canonical205_files(self.source,self.files),self.admitted['prefix205'])
        self.assertEqual(C.canonical_prefix(self.source,self.files),self.admitted['prefix204'])
        old = C.canonical_binding(self.source,self.files)
        new = R.canonical_review_binding(self.source,self.files)
        self.assertEqual(old['filename'],C.CANONICAL_FILENAME)
        self.assertEqual(old['canonical_migration_count'],205)
        self.assertEqual(len(old['expected_statements']),94)
        self.assertEqual(new['filename'],R.CANONICAL_FILENAME)
        self.assertEqual(new['canonical_migration_count'],206)
        self.assertEqual(len(new['expected_statements']),304)
        self.assertEqual(new['body_sha256'],REVIEW_BODY.BODY_SHA256)
        self.assertEqual(A.build_release(self.source,self.admitted['prefix204'])['artifact_sha256'],B.ARTIFACT_SHA256)

    def test_omitted_extra_reordered_duplicate_and_foreign_paths_refused(self):
        variants = [self.files[:-1], self.files[1:], list(reversed(self.files)),
                    self.files[:-1]+[self.files[0]], self.files+[self.files[-1]]]
        for files in variants:
            for validator in (R.admit_canonical206,C.canonical_prefix,C.canonical_binding):
                with self.subTest(validator=validator.__name__,count=len(files)),self.assertRaises(AssertionError):
                    validator(self.source,files)
        with tempfile.TemporaryDirectory() as folder:
            foreign=Path(folder)/self.files[-1].name
            foreign.write_bytes(self.files[-1].read_bytes())
            with self.assertRaisesRegex(AssertionError,'directory'):
                R.admit_canonical206(self.source,self.files[:-1]+[foreign])

    def test_actual_extra_file_refused_even_if_caller_omits_it(self):
        extra = self.files[-1].parent/'20261023010000_unreviewed.sql'
        try:
            extra.write_text('select 1;\n')
            for files in (self.files,sorted(extra.parent.glob('*.sql'))):
                with self.assertRaises(AssertionError):
                    C.canonical_prefix(self.source,files)
        finally:
            extra.unlink()

    def test_changed_old_or_new_body_and_name_refused(self):
        for path in (self.files[0],self.files[204],self.files[205]):
            original=path.read_bytes()
            try:
                path.write_bytes(original+b'\n')
                with self.assertRaises(AssertionError):
                    R.admit_canonical206(self.source,self.files)
            finally:
                path.write_bytes(original)
        path=self.files[-1];renamed=path.with_name('20261022010001_controlled_secondary_review_private.sql')
        try:
            path.rename(renamed)
            with self.assertRaises(AssertionError):
                R.admit_canonical206(self.source,sorted(renamed.parent.glob('*.sql')))
        finally:
            renamed.rename(path)

    def test_pin_and_official_parser_source_drift_cannot_admit_prefix(self):
        for name in ('release-expected-204.json','secondary_review_protocol_private_expected_v2.json',
                     REVIEW_LEDGER.LEDGER_FILE,REVIEW_BODY.STATEMENTS_FILE,
                     REVIEW_LEDGER.VENDOR+'/sql-split.ts'):
            path=self.source/name;original=path.read_bytes()
            try:
                path.write_bytes(original+b'\n')
                with self.subTest(name=name),self.assertRaises(AssertionError):
                    C.canonical205_files(self.source,self.files)
            finally:
                path.write_bytes(original)

    def test_admission_map_includes_complete_executed_imports_and_new_trust_inputs(self):
        inputs=C.canonical_admission_inputs(self.source,self.files)
        self.assertEqual(inputs,self.admitted['input_source_hashes'])
        for name in ('canonical_prefix.py','canonical_review_prefix.py','secondary_review_cli_body.py',
                     'secondary_review_release.py','secondary_review_ledger.py','cli_migration_body.py',
                     'release_assembly.py','local_install.py','derive_column_acl_pin.py',
                     REVIEW_LEDGER.LEDGER_FILE,REVIEW_BODY.STATEMENTS_FILE,
                     REVIEW_LEDGER.VENDOR+'/sql-split.ts'):
            path=self.source/name
            self.assertEqual(inputs[str(path.relative_to(self.root))],hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(len([name for name in inputs if name.startswith('supabase/migrations/')]),206)


if __name__ == '__main__':
    unittest.main()
