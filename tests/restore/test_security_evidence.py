"""Security diagnostics cannot leak restored code/configuration or mask ACL drift."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('security_evidence', Path(__file__).resolve().parents[2] / 'scripts/restore-rehearsal/security_evidence.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SecurityEvidenceTests(unittest.TestCase):
    def test_privilege_difference_is_not_ordering(self):
        source = {'relations': [{'name': 'history_seq', 'UPDATE': False}]}
        restored = {'relations': [{'name': 'history_seq', 'UPDATE': True}]}
        result = module.security_mismatch(source, restored)
        self.assertFalse(result['equal'])
        self.assertFalse(result['sections'][0]['ordering_only'])
        self.assertEqual(len(result['sections'][0]['source_only_sha256']), 1)

    def test_routine_bodies_and_settings_never_escape(self):
        source = {'functions': [{'definition': 'private_source_body', 'config': 'private_source_config'}]}
        restored = {'functions': [{'definition': 'private_restored_body', 'config': 'private_restored_config'}]}
        serialized = json.dumps(module.security_mismatch(source, restored))
        self.assertNotIn('private_', serialized)
        self.assertNotIn('definition', serialized)
        self.assertNotIn('config', serialized)

    def test_ordering_is_reported_but_not_accepted_as_equal(self):
        result = module.security_mismatch({'triggers': [1, 2]}, {'triggers': [2, 1]})
        self.assertFalse(result['equal'])
        self.assertTrue(result['sections'][0]['ordering_only'])
        self.assertEqual(module.security_mismatch({'triggers': [1]}, {'triggers': [1]}), {'equal': True, 'sections': []})
