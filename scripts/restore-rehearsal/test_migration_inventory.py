"""Offline inventory checks: upgrade rehearsals must cover the canonical release."""
import ast
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SCRIPT = Path(__file__).with_name("run.py")


def historical_versions():
    # These restore scenarios intentionally retain the original 206 release.
    # Current 208 installation/business acceptance has its own complete suite.
    spec = importlib.util.spec_from_file_location("historical_inventory_prefix", ROOT / "scripts/narcotics-log/prefix_view.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    pins = module.canonical206(ROOT)
    return sorted(Path(name).name.split("_", 1)[0] for name in pins)


def assigned_literal(name):
    tree = ast.parse(SCRIPT.read_text())
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and any(isinstance(target, ast.Name) and target.id == name for target in statement.targets):
            return ast.literal_eval(statement.value)
    raise AssertionError("Missing reviewed inventory: " + name)


class MigrationInventoryTests(unittest.TestCase):
    def test_retained_restore_count_matches_unique_historical_versions(self):
        versions = historical_versions()
        self.assertEqual(len(versions), len(set(versions)))
        self.assertEqual(assigned_literal("CURRENT_RESTORE_MIGRATION_COUNT"), len(versions))

    def test_both_upgrade_modes_include_every_post_baseline_migration(self):
        # Both reviewed historical baseline modes share this explicit suffix.
        expected = [version for version in historical_versions() if version >= "20260914010000"]
        self.assertEqual(assigned_literal("new_versions"), expected)


if __name__ == "__main__":
    unittest.main()
