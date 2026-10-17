"""Offline inventory checks: upgrade rehearsals must cover the canonical release."""
import ast
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = Path(__file__).with_name("run.py")


def assigned_literal(name):
    tree = ast.parse(SCRIPT.read_text())
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and any(isinstance(target, ast.Name) and target.id == name for target in statement.targets):
            return ast.literal_eval(statement.value)
    raise AssertionError("Missing reviewed inventory: " + name)


class MigrationInventoryTests(unittest.TestCase):
    def test_current_restore_count_matches_unique_canonical_versions(self):
        versions = [path.name.split("_", 1)[0] for path in (ROOT / "supabase/migrations").glob("*.sql")]
        self.assertEqual(len(versions), len(set(versions)))
        self.assertEqual(assigned_literal("CURRENT_RESTORE_MIGRATION_COUNT"), len(versions))

    def test_both_upgrade_modes_include_every_post_baseline_migration(self):
        # Both reviewed historical baseline modes share this explicit suffix.
        expected = sorted(path.name.split("_", 1)[0] for path in (ROOT / "supabase/migrations").glob("*.sql") if path.name.split("_", 1)[0] >= "20260914010000")
        self.assertEqual(assigned_literal("new_versions"), expected)


if __name__ == "__main__":
    unittest.main()
