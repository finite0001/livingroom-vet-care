"""Whole-source restoration, overwrite semantics and scope refusals."""
import json
import unittest
from unittest.mock import patch

import compact_descriptor as compact
import validated_client_constraint as source


class CompactDescriptorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.current = (source.ROOT / 'supabase/migrations' / source.MIGRATION).read_bytes()
        cls.original = compact.canonical(cls.current)

    def test_whole_inverse_recovers_reviewed_pr317_source(self):
        self.assertEqual(compact.sha(self.original), compact.ORIGINAL_SHA)
        self.assertEqual(compact.derive(self.original), self.current)
        self.assertEqual(compact.derive(self.current), self.current)

    def test_only_descriptor_statement_changes_and_fits_source_guard_size(self):
        old, new = self.original.decode(), self.current.decode()
        a, b = compact.bounds(old)
        c, d = compact.bounds(new)
        self.assertEqual(old[:a], new[:c])
        self.assertEqual(old[b:], new[d:])
        self.assertLess(len(new[c:d].encode()), 10_000_000)
        self.assertLess(d - c, (b - a) // 3)

    def test_dropped_properties_are_overwritten_without_changing_any_header(self):
        full, header = compact.frozen_descriptor()
        decode = lambda text: json.loads(text[1:-8].replace("''", "'"))
        original, compacted = decode(full), decode(header)
        self.assertIn('properties', original)
        self.assertNotIn('properties', compacted)
        for final_properties in ({}, {'example': [1, None, "owner's source"]}, None):
            self.assertEqual(original | {'properties': final_properties},
                             compacted | {'properties': final_properties})

    def test_changed_overwrite_reference_or_limits_refuse(self):
        text = self.current.decode()
        for before, after in ((compact.BASE + ' CONSTANT', compact.BASE + ' jsonb;--'),
                              (compact.BASE + "->'original269'", compact.BASE + "->'parent205'"),
                              ("||jsonb_build_object('properties',", "||jsonb_build_object('changed',"),
                              ("SET LOCAL statement_timeout='8s'", "SET LOCAL statement_timeout='9s'")):
            self.assertIn(before, text)
            with self.assertRaises(ValueError):
                compact.canonical(text.replace(before, after, 1).encode())

    def test_unrelated_statement_changes_refuse(self):
        with self.assertRaises(ValueError):
            compact.canonical(self.current + b'\nSELECT 1;\n')

    def test_equivalent_json_with_unreviewed_source_bytes_refuses(self):
        raw = compact.prefix.regular(source.HERE / 'module-expected.json')
        with patch.object(compact.prefix, 'regular', return_value=raw + b'\n'):
            with self.assertRaises(ValueError):
                compact.frozen_descriptor()


if __name__ == '__main__':
    unittest.main()
