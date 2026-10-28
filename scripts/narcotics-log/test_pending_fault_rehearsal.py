"""Source fault controls; normal Auth acceptance requires separate real runs."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
import unittest

import pending_fault_rehearsal as fault


class PendingFaultSourceControls(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        here = Path(__file__).resolve().parent
        cls.raw = (here.parents[1] / 'supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql').read_text()
        cls.expected = json.loads((here / 'module-expected.json').read_text())

    def test_only_three_exact_source_bodies_change_and_fault_follows_full_validation(self):
        programs, proof = fault.overlays(self.raw, self.expected)
        self.assertEqual(set(proof), set(fault.SIGNATURES))
        self.assertTrue(all(value['whole_body_inverse'] for value in proof.values()))
        guard = programs[0]
        self.assertLess(guard.index('PERFORM controlled_count_v1.product_live_causes(OLD.product_id);'),
                        guard.index("RAISE EXCEPTION '" + fault.FAULT_MESSAGE))
        self.assertLess(guard.index("RAISE EXCEPTION '" + fault.FAULT_MESSAGE), guard.index('RETURN OLD;'))
        for program in programs[1:]:
            self.assertIn("IF SQLSTATE='PZ046'THEN RAISE;END IF;", program)
            self.assertIn("raise exception 'count_request_failed'using errcode='P0001',detail='',hint='';", program)

    def test_unadmitted_source_body_hash_refuses(self):
        expected = deepcopy(self.expected)
        expected['properties']['functions'][fault.SIGNATURES[0]]['body_sha256'] = 'f' * 64
        with self.assertRaises(ValueError):
            fault.overlays(self.raw, expected)

    def test_missing_full_validator_refuses_even_if_an_expected_hash_is_supplied(self):
        signature = fault.SIGNATURES[0]
        start = self.raw.index('CREATE FUNCTION ' + signature)
        body_start = self.raw.index(' AS $$', start) + len(' AS $$')
        end = self.raw.index('$$;', body_start)
        body = self.raw[body_start:end]
        altered = body.replace('PERFORM controlled_count_v1.product_live_causes(OLD.product_id);', 'PERFORM 1;', 1)
        self.assertNotEqual(body, altered)
        raw = self.raw[:body_start] + altered + self.raw[end:]
        expected = deepcopy(self.expected)
        expected['properties']['functions'][signature]['body_sha256'] = hashlib.sha256(altered.encode()).hexdigest()
        with self.assertRaises(ValueError):
            fault.overlays(raw, expected)


if __name__ == '__main__':
    unittest.main()
