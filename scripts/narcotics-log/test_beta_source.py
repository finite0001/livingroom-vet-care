"""Source inventory controls do not establish database acceptance."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import prefix_view as prefix


class BetaSourceTests(unittest.TestCase):
    def fixture(self, root):
        body = b"SELECT 1;\n"
        migration = root / "supabase/migrations" / prefix.BETA_MIGRATION
        migration.parent.mkdir(parents=True)
        migration.write_bytes(body)
        manifest = root / prefix.BETA_MANIFEST
        manifest.parent.mkdir(parents=True)
        value = dict(kind="beta-atomic-time-clock-cli210-source-v1", cli_version="2.118.0",
            prefix_migration_count=209, migration_count=210, migration=prefix.BETA_MIGRATION,
            database_operations=0, framing=dict(bytes=len(body), sha256=prefix.digest(body),
                statement_count=1, compact_array_sha256="a" * 64,
                postgres_array_sha256="b" * 64, postgres_array_bytes=13,
                statement_sha256s=["c" * 64]))
        manifest.write_text(json.dumps(value))
        return migration, manifest, value

    def test_separately_admitted_manifest_does_not_claim_runtime_acceptance(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            _, _, expected = self.fixture(root)
            self.assertEqual(prefix.beta210(root), expected)
            self.assertEqual(expected["database_operations"], 0)

    def test_source_edit_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            migration, _, _ = self.fixture(root)
            migration.write_text("SELECT 2;\n")
            with self.assertRaises(ValueError):
                prefix.beta210(root)

    def test_misnamed_or_incomplete_or_relabelled_manifest_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            _, manifest, original = self.fixture(root)
            changes = [dict(migration="20261106170001_other.sql"), dict(migration_count=211),
                       dict(prefix_migration_count=208), dict(database_operations=1)]
            for change in changes:
                with self.subTest(change=change):
                    value = {**original, **change}
                    manifest.write_text(json.dumps(value))
                    with self.assertRaises(ValueError):
                        prefix.beta210(root)
            value = copy.deepcopy(original)
            value["framing"]["statement_sha256s"] = []
            manifest.write_text(json.dumps(value))
            with self.assertRaises(ValueError):
                prefix.beta210(root)

    def test_unknown_extra_migration_is_rejected_before_beta_admission(self):
        migrations = list((prefix.ROOT / "supabase/migrations").glob("*.sql"))
        extra = prefix.ROOT / "supabase/migrations/20261106170001_unreviewed.sql"
        with patch.object(Path, "glob", return_value=iter([*migrations, extra])):
            with self.assertRaises(ValueError):
                prefix.canonical206(prefix.ROOT)

    def test_catalog_successor_is_exact_and_does_not_admit_source_edits(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            migration = root / 'supabase/migrations' / prefix.CATALOG_MIGRATION
            migration.parent.mkdir(parents=True)
            migration.write_bytes(b'SELECT 1;\n')
            manifest = root / prefix.CATALOG_MANIFEST
            manifest.parent.mkdir(parents=True)
            value = dict(kind='catalog-drafts-cli212-source-v1',cli_version='2.118.0',
                prefix_migration_count=211,migration_count=212,migration=prefix.CATALOG_MIGRATION,
                database_operations=0,framing=dict(bytes=10,sha256=prefix.digest(migration.read_bytes()),
                    statement_count=1,compact_array_sha256='a'*64,postgres_array_sha256='b'*64,
                    postgres_array_bytes=13,statement_sha256s=['c'*64]))
            manifest.write_text(json.dumps(value))
            self.assertEqual(prefix.catalog212(root),value)
            migration.write_bytes(b'SELECT 2;\n')
            with self.assertRaises(ValueError):
                prefix.catalog212(root)
            migration.write_bytes(b'SELECT 1;\n')
            manifest.write_text(json.dumps({**value,'migration_count':213}))
            with self.assertRaises(ValueError):
                prefix.catalog212(root)

    def test_browser_driver_uses_the_current_acceptance_manifest(self):
        import beta_rehearsal as beta
        source = (prefix.ROOT / 'tests/controlled-drugs/run-beta-authenticated-count-finalize.mjs').read_text()
        self.assertIn(str(beta.MANIFEST.relative_to(prefix.ROOT)), source)
        self.assertNotIn("'scripts/narcotics-log/beta-candidate-source.json'", source)


if __name__ == "__main__":
    unittest.main()
