"""Frozen-source equivalence and refusal checks for the install-only guard."""
import json
import unittest

import compact_source_guard as compact
import validated_client_constraint as source


class CompactSourceGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.current = (source.ROOT / 'supabase/migrations' / source.MIGRATION).read_bytes()
        cls.original = compact.canonical(cls.current)

    def test_whole_inverse_recovers_exact_reviewed_pr316(self):
        self.assertEqual(compact.sha(self.original), compact.ORIGINAL_SHA)
        self.assertEqual(compact.derive(self.original), self.current)
        self.assertEqual(compact.derive(self.current), self.current)

    def test_only_guard_bytes_change_and_statement_count_stays_one(self):
        old = self.original.decode()
        new = self.current.decode()
        a, b = compact.bounds(old)
        c, d = compact.bounds(new)
        self.assertEqual(old[:a], new[:c])
        self.assertEqual(old[b:], new[d:])
        self.assertLess(d - c, (b - a) // 2)

    def test_reused_value_is_exact_embedded_source_snapshot(self):
        old = self.original.decode()
        a, b = compact.bounds(old)
        base, review = compact.literals(old[a:b])
        decode = lambda literal: json.loads(literal[1:-8].replace("''", "'"))
        self.assertEqual(decode(base)['original269'], decode(review))
        self.assertEqual(old[a:b].count(review), 3)

    def test_changed_source_or_constant_inventory_refuses(self):
        text = self.current.decode()
        for before, after in ((compact.BASE + ' CONSTANT', compact.BASE + ' jsonb;--'),
                              (compact.REVIEW + ' CONSTANT', 'other CONSTANT'),
                              (compact.BASE + "->'original269'", compact.BASE + "->'parent205'"),
                              ('IF actual', 'IF NULL'),
                              ("SET LOCAL statement_timeout='8s'", "SET LOCAL statement_timeout='9s'")):
            self.assertIn(before, text)
            with self.assertRaises(ValueError):
                compact.canonical(text.replace(before, after, 1).encode())

    def test_changes_outside_guard_refuse_even_when_constants_unchanged(self):
        with self.assertRaises(ValueError):
            compact.canonical(self.current + b'\nSELECT 1;\n')


if __name__ == '__main__':
    unittest.main()
