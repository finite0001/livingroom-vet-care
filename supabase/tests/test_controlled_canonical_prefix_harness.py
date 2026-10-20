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
        shutil.copytree(ROOT / 'supabase/migrations', cls.root / 'supabase/migrations')
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


if __name__ == '__main__':
    unittest.main()
