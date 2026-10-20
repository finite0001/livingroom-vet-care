"""Independent parent-bound pin derivation; no database or subprocess calls."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'tests/controlled-drugs/engine/candidate'
SPEC = importlib.util.spec_from_file_location('column_acl_pin_derivation', SOURCE / 'derive_column_acl_pin.py')
DERIVE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(DERIVE)


class ColumnAclPinDerivationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.parent_raw = (SOURCE / 'release-expected-204-v1.json').read_bytes()
        cls.parent = json.loads(cls.parent_raw)
        cls.new_seal = (SOURCE / 'seal.sql').read_bytes()
        new_sql = cls.new_seal.decode()
        assert new_sql.count(DERIVE.NEW_COLUMN_FRAGMENT) == 1
        assert new_sql.count("'version',2,'functions',(") == 1
        cls.old_seal = new_sql.replace(DERIVE.NEW_COLUMN_FRAGMENT, DERIVE.OLD_COLUMN_FRAGMENT, 1).replace(
            "'version',2,'functions',(", "'version',1,'functions',(", 1).encode()
        # This independently retained checksum, not the reconstructed SQL, is trust.
        assert hashlib.sha256(cls.old_seal).hexdigest() == cls.parent['assembled_sql_hashes'][DERIVE.SEAL_PATH]
        cls.supplement = {
            'kind': 'independent-released286-column-acl-supplement-v1',
            'old_manifest_matches': True,
            'snapshot_function_definition': DERIVE.snapshot_function_definition(cls.old_seal.decode()),
            'writers': copy.deepcopy(cls.parent['canonical_writer_definition_hashes']),
            'relations': {name: {column['name']: [] for column in relation['columns']}
                          for name, relation in cls.parent['expected_technical_manifest']['relations'].items()},
        }

    def args(self):
        return [self.parent_raw, self.old_seal, self.new_seal, copy.deepcopy(self.supplement)]

    def test_exact_derivation_matches_reviewed_active_pin_without_mutating_parent(self):
        args = self.args()
        original = copy.deepcopy(args)
        actual = DERIVE.derive_pin(*args)
        self.assertEqual(actual, json.loads((SOURCE / 'release-expected-204.json').read_text()))
        self.assertEqual(args, original)
        self.assertEqual(hashlib.sha256(args[0]).hexdigest(), DERIVE.PARENT_PIN_SHA256)

    def test_changed_parent_bytes_cannot_be_adopted_as_new_trust(self):
        args = self.args()
        args[0] += b'\n'
        with self.assertRaises(AssertionError):
            DERIVE.derive_pin(*args)

    def test_unallowlisted_new_seal_sql_is_rejected(self):
        args = self.args()
        args[2] += b'\nselect 1;\n'
        with self.assertRaisesRegex(AssertionError, 'Only reviewed'):
            DERIVE.derive_pin(*args)

    def test_unexpected_old_column_grant_is_refused_not_captured(self):
        args = self.args()
        columns = next(iter(args[3]['relations'].values()))
        columns[next(iter(columns))] = [{'grantee': 'authenticated', 'grantor': 'postgres',
                                         'privilege': 'SELECT', 'grantable': False}]
        with self.assertRaisesRegex(AssertionError, 'never adoption'):
            DERIVE.derive_pin(*args)

    def test_missing_old_column_or_changed_writer_cannot_satisfy_provenance(self):
        for mutation in ('missing_column', 'changed_writer'):
            args = self.args()
            if mutation == 'missing_column':
                columns = next(iter(args[3]['relations'].values()))
                del columns[next(iter(columns))]
            else:
                writers = args[3]['writers']
                writers[next(iter(writers))] = '0' * 64
            with self.subTest(mutation=mutation), self.assertRaises(AssertionError):
                DERIVE.derive_pin(*args)

    def test_old_actual_function_definition_must_match_pinned_renderer(self):
        args = self.args()
        args[3]['snapshot_function_definition'] += '\n'
        with self.assertRaises(AssertionError):
            DERIVE.derive_pin(*args)


if __name__ == '__main__':
    unittest.main()
