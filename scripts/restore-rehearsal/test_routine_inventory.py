"""Counterexamples that must prevent an inventory match from being reported."""
import copy
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).with_name('compare-routine-inventories.py')
BASE = {
    'versions': ['20260913270000'],
    'routines': [{'signature': 'staff_action()', 'owner': 'postgres',
                  'definition_md5': 'a' * 32, 'security_definer': True,
                  'configuration': ['search_path=public'],
                  'execute_grants': {'anon': False, 'authenticated': True, 'service_role': False}}],
    'triggers': [{'table_name': 'records', 'trigger_name': 'immutable',
                  'enabled_mode': 'O', 'definition': 'CREATE TRIGGER immutable ...'}],
}


class InventoryComparison(unittest.TestCase):
    def compare(self, observed):
        with tempfile.TemporaryDirectory() as directory:
            paths = [Path(directory)/name for name in ['expected.json', 'observed.json']]
            for path, value in zip(paths, [BASE, observed]):
                path.write_text(json.dumps(value))
            return subprocess.run([sys.executable, str(SCRIPT), *map(str, paths)],
                                  capture_output=True, text=True)

    def test_identical_inventory(self):
        self.assertEqual(self.compare(BASE).returncode, 0)

    def test_routine_authority_and_definition_drift(self):
        changes = {'owner': 'different_owner', 'definition_md5': 'b'*32,
                   'security_definer': False, 'configuration': None,
                   'execute_grants': {'anon': True, 'authenticated': True, 'service_role': True}}
        for field, value in changes.items():
            with self.subTest(field=field):
                observed = copy.deepcopy(BASE)
                observed['routines'][0][field] = value
                result = self.compare(observed)
                self.assertEqual(result.returncode, 1)
                self.assertIn(field, json.loads(result.stdout)['changed_routines']['staff_action()'])

    def test_disabled_or_replica_only_trigger(self):
        for mode in ['D', 'R']:
            observed = copy.deepcopy(BASE)
            observed['triggers'][0]['enabled_mode'] = mode
            self.assertEqual(self.compare(observed).returncode, 1)

    def test_changed_history_or_missing_routine(self):
        observed = copy.deepcopy(BASE)
        observed['versions'].append('20260913300000')
        self.assertEqual(self.compare(observed).returncode, 1)
        observed = copy.deepcopy(BASE)
        observed['routines'][0]['signature'] = 'other_action()'
        self.assertEqual(self.compare(observed).returncode, 1)

    def test_empty_or_duplicate_inventory_rejected(self):
        self.assertNotEqual(self.compare({}).returncode, 0)
        observed = copy.deepcopy(BASE)
        observed['routines'].append(copy.deepcopy(observed['routines'][0]))
        self.assertNotEqual(self.compare(observed).returncode, 0)


if __name__ == '__main__':
    unittest.main()
