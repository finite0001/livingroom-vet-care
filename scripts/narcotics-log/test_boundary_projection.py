"""Mutation and READ freshness must retain the same complete physical evidence."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'supabase/migrations/20261027223544_narcotics_count_and_stock_workflows.sql'


def body(source, name):
    declarations = list(re.finditer(r'CREATE(?: OR REPLACE)? FUNCTION ' + re.escape(name) + r'\(', source))
    if len(declarations) != 1:
        raise ValueError('Exactly one final physical capture function required')
    start = source.index(' AS $$', declarations[0].start()) + len(' AS $$')
    return source[start:source.index('$$;', start)]


class PhysicalBoundaryProjectionTests(unittest.TestCase):
    def test_read_and_mutation_retain_identical_complete_source_capture(self):
        source = SOURCE.read_text()
        original = body(source, 'controlled_count_v1.capture_full_boundary')
        read = body(source, 'controlled_count_v1.capture_full_boundary_read')
        read_gate = 'controlled_count_entry_v1.assert_count_read_capture_frontier(p_count,p_actor,p_product,p_site)'
        mutation_gate = 'controlled_count_entry_v1.assert_capture_frontier(p_product,p_site)'
        self.assertEqual(read.count(read_gate), 2)
        self.assertEqual(read.replace(read_gate, mutation_gate), original)
        self.assertIn("w.stage='saved'", read)
        self.assertIn('join public.controlled_stock_events e on e.id=w.parent_action_id', read)


if __name__ == '__main__':
    unittest.main()
